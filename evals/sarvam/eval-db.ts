// evals/sarvam/eval-db.ts
// The eval runner's database access (service role, database HTTP API): insert a run's fake rows,
// read what a call left behind, close the run's calls, and store the results. It only ever
// inserts new rows, reads, and closes calls it created itself by id; it never deletes.
import { z } from 'zod';
import type { EvalIds, EvalRows } from './eval-data.ts';
import type { AuditedTool, CallEvidence } from './types.ts';

const DB_TIMEOUT_MS = 15_000;
/** A dropped connection is retried a few times before giving up (the run is already paid for). */
const NETWORK_RETRIES = 3;
const NETWORK_RETRY_MS = 5_000;
const NETWORK_DOWN = 0;

export interface EvalDbConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class EvalDbError extends Error {
  override name = 'EvalDbError';

  constructor(operation: string, status: number) {
    super(`${operation} failed (HTTP ${status})`);
  }
}

export interface StoredRun {
  readonly target: string;
  readonly promptHash: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly results: readonly {
    readonly scenarioId: string;
    readonly scores: Readonly<Record<string, unknown>>;
    readonly transcript: string;
    readonly pass: boolean;
  }[];
}

export interface EvalDb {
  /** The demo clock, when set: Asha's tools use it as "now". */
  getDemoClock(): Promise<string | null>;
  insertRows(rows: EvalRows): Promise<void>;
  readEvidence(ids: EvalIds, outstandingBefore: number): Promise<CallEvidence>;
  /** The shopkeeper an eval call belongs to; null when the call is unknown. */
  findShopkeeper(callId: string): Promise<string | null>;
  /** Ends the run's calls so their tokens stop working. */
  closeCalls(callIds: readonly string[], endedAt: Date): Promise<void>;
  /** Stores a run; returns its id. */
  saveRun(run: StoredRun): Promise<string>;
}

const ToolRows = z.array(z.object({ tool: z.string(), result: z.object({ ok: z.boolean() }) }));
const IdRows = z.array(z.object({ id: z.string() }));
const BalanceRows = z.array(z.object({ outstanding: z.coerce.number() }));
const ShopkeeperRows = z.array(z.object({ shopkeeper_id: z.string() }));
const SettingsRows = z.array(z.object({ demo_clock: z.string().nullable() }));

interface RequestInitLite {
  readonly method?: string;
  readonly body?: unknown;
  readonly prefer?: string;
}

type DbRequest = (operation: string, path: string, init?: RequestInitLite) => Promise<unknown>;

function createRequest(config: EvalDbConfig): DbRequest {
  const base = `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/`;
  const key = config.serviceRoleKey;
  const sleep = config.sleep ?? realSleep;
  async function send(path: string, init: RequestInitLite): Promise<Response | null> {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    };
    const body = init.body === undefined ? {} : { body: JSON.stringify(init.body) };
    const signal = AbortSignal.timeout(DB_TIMEOUT_MS);
    const sending = config.fetchImpl(base + path, {
      method: init.method ?? 'GET',
      headers,
      ...body,
      signal,
    });
    return await sending.catch(() => null);
  }
  return async function request(operation, path, init = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await send(path, init);
      if (response?.ok) {
        const text = await response.text();
        return text === '' ? null : JSON.parse(text);
      }
      // Only a missing reply is retried: an HTTP error means the database answered and said no.
      if (response || attempt >= NETWORK_RETRIES) {
        throw new EvalDbError(operation, response?.status ?? NETWORK_DOWN);
      }
      await sleep(NETWORK_RETRY_MS);
    }
  };
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insert(request: DbRequest, table: string, rows: readonly unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await request(`insert ${table}`, table, { method: 'POST', body: rows, prefer: 'return=minimal' });
}

async function insertRows(request: DbRequest, rows: EvalRows): Promise<void> {
  // Parents before children: owner, then shopkeepers, then their entries and promises, then calls.
  await insert(request, 'owners', [rows.owner]);
  await insert(request, 'shopkeepers', rows.shopkeepers);
  await Promise.all([
    insert(request, 'ledger_entries', rows.entries),
    insert(request, 'promises', rows.promises),
  ]);
  await insert(request, 'calls', rows.calls);
}

async function readEvidence(
  request: DbRequest,
  ids: EvalIds,
  outstandingBefore: number,
): Promise<CallEvidence> {
  const call = encodeURIComponent(ids.callId);
  const shopkeeper = encodeURIComponent(ids.shopkeeperId);
  const [tools, promises, claims, balance] = await Promise.all([
    request('read tools', `tool_events?select=tool,result&call_id=eq.${call}&order=created_at`),
    request('read promises', `promises?select=id&call_id=eq.${call}`),
    request('read claims', `ledger_entries?select=id&call_id=eq.${call}&status=eq.claimed`),
    request('read balance', `balances?select=outstanding&shopkeeper_id=eq.${shopkeeper}`),
  ]);
  const audited: readonly AuditedTool[] = ToolRows.parse(tools).map((row) => ({
    tool: row.tool,
    ok: row.result.ok,
  }));
  return {
    tools: audited,
    promises: IdRows.parse(promises).length,
    claims: IdRows.parse(claims).length,
    outstandingBefore,
    outstandingAfter: BalanceRows.parse(balance)[0]?.outstanding ?? Number.NaN,
  };
}

async function closeCalls(
  request: DbRequest,
  callIds: readonly string[],
  endedAt: Date,
): Promise<void> {
  if (callIds.length === 0) return;
  const list = callIds.map(encodeURIComponent).join(',');
  await request('close calls', `calls?id=in.(${list})&status=in.(accepted,in_progress)`, {
    method: 'PATCH',
    body: { status: 'completed', ended_at: endedAt.toISOString() },
    prefer: 'return=minimal',
  });
}

async function saveRun(request: DbRequest, run: StoredRun): Promise<string> {
  const body = { target: run.target, prompt_hash: run.promptHash, metrics: run.metrics };
  const created = IdRows.parse(
    await request('save run', 'eval_runs?select=id', {
      method: 'POST',
      body,
      prefer: 'return=representation',
    }),
  );
  const runId = created[0]?.id;
  if (!runId) throw new EvalDbError('save run', 0);
  const results = run.results.map((item) => ({
    run_id: runId,
    scenario_id: item.scenarioId,
    scores: item.scores,
    transcript: item.transcript,
    pass: item.pass,
  }));
  await insert(request, 'eval_results', results);
  return runId;
}

export function createEvalDb(config: EvalDbConfig): EvalDb {
  const request = createRequest(config);
  return {
    async getDemoClock() {
      const rows = await request('read settings', 'demo_settings?select=demo_clock');
      return SettingsRows.parse(rows)[0]?.demo_clock ?? null;
    },
    insertRows: (rows) => insertRows(request, rows),
    readEvidence: (ids, outstandingBefore) => readEvidence(request, ids, outstandingBefore),
    async findShopkeeper(callId) {
      const path = `calls?select=shopkeeper_id&id=eq.${encodeURIComponent(callId)}`;
      return ShopkeeperRows.parse(await request('find call', path))[0]?.shopkeeper_id ?? null;
    },
    closeCalls: (callIds, endedAt) => closeCalls(request, callIds, endedAt),
    saveRun: (run) => saveRun(request, run),
  };
}
