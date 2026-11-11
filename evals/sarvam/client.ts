// evals/sarvam/client.ts
// Client for Sarvam's Tests API (docs.sarvam.ai/voice-agents/api/tests, read 2026-11-11):
// create a suite with its cases, map its variables to one agent version, start a run, poll it,
// and read each case's transcript and verdicts. Every reply is checked with Zod. The API key
// goes in a header only and is never logged; errors carry the step and HTTP status, nothing else.
import { z } from 'zod';
import type { Behaviour, TranscriptTurn, Verdict } from './types.ts';

export const SARVAM_TESTS_BASE = 'https://apps.sarvam.ai/api/evals/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMITED = 429;
/** Reported as the status when there was no reply at all (DNS, dropped connection). */
const NETWORK_DOWN = 0;
/** Sarvam allows 10 suite runs per 5 minutes; a 429 says how long to wait (Retry-After). */
export const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 30;
const MAX_RETRY_AFTER_S = 150;
const PASS = 'pass';

export interface SarvamTestsConfig {
  readonly apiKey: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly fetchImpl: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  /** Told each time a rate limit makes the client wait. */
  readonly onWait?: (seconds: number) => void;
}

export interface SuiteVariable {
  readonly name: string;
  readonly value: string;
}

export interface SuiteCase {
  readonly name: string;
  readonly category: string;
  readonly user_scenario: string;
  readonly expected_behaviors: readonly Behaviour[];
  readonly variable_overrides: readonly SuiteVariable[];
  readonly max_turns: number;
}

export interface NewSuite {
  readonly name: string;
  readonly description: string;
  readonly variables: readonly SuiteVariable[];
  readonly global_guardrails: readonly string[];
  readonly test_cases: readonly SuiteCase[];
}

export interface AgentVersion {
  readonly appId: string;
  readonly appVersion: number;
}

export interface RunStatus {
  readonly status: 'created' | 'running' | 'completed' | 'failed';
  readonly total: number;
  readonly completed: number;
}

export interface CaseExecution {
  readonly transcript: readonly TranscriptTurn[];
  readonly verdicts: readonly Verdict[];
}

export class SarvamTestsError extends Error {
  override name = 'SarvamTestsError';
  readonly status: number;

  constructor(step: string, status: number) {
    super(`${step} failed (HTTP ${status})`);
    this.status = status;
  }
}

const SuiteCreated = z.object({ test_suite_id: z.string().min(1) });
const SuiteRead = z.object({
  test_cases: z.array(
    z.object({
      test_case_id: z.string().min(1),
      name: z.string(),
      variable_overrides: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
    }),
  ),
});
const RunStarted = z.object({ run_id: z.string().min(1) });
const RunRead = z.object({
  status: z.enum(['created', 'running', 'completed', 'failed']),
  total_executions: z.number().int().nonnegative().catch(0),
  completed_executions: z.number().int().nonnegative().catch(0),
});
const Execution = z.object({
  transcript: z.array(z.object({ role: z.string(), content: z.string().nullable() })).nullish(),
  transcript_text: z.string().nullish(),
  evaluation_results: z
    .array(z.object({ name: z.string(), verdict: z.string(), reasoning: z.string().nullish() }))
    .nullish(),
});
const CaseResults = z.object({ executions: z.array(Execution) });

function toExecution(row: z.infer<typeof Execution>): CaseExecution {
  const turns = row.transcript ?? [];
  const transcript =
    turns.length > 0
      ? turns.map((turn) => ({ role: turn.role, content: turn.content ?? '' }))
      : [{ role: 'transcript', content: row.transcript_text ?? '' }];
  const verdicts = (row.evaluation_results ?? []).map((item) => ({
    name: item.name,
    passed: item.verdict.trim().toLowerCase() === PASS,
    reasoning: item.reasoning ?? '',
  }));
  return { transcript, verdicts };
}

/** One case of a suite as stored in Sarvam: its id, our case id (its name) and its variables. */
export interface StoredCase {
  readonly caseId: string;
  readonly name: string;
  readonly variables: ReadonlyMap<string, string>;
}

export interface SarvamTests {
  /** The cases of an existing suite (used to pick up a run that was started earlier). */
  listCases(suiteId: string): Promise<readonly StoredCase[]>;
  /** Creates a workspace-level suite; returns its id and each case's id by case name. */
  createSuite(suite: NewSuite): Promise<{ suiteId: string; caseIds: ReadonlyMap<string, string> }>;
  /** Feeds each agent variable from the suite variable of the same name. */
  mapVariables(suiteId: string, agent: AgentVersion, names: readonly string[]): Promise<void>;
  startRun(suiteId: string, agent: AgentVersion, runName: string): Promise<string>;
  getRun(suiteId: string, runId: string): Promise<RunStatus>;
  /** One entry per execution of the case (one, at frequency 1). */
  getCaseResults(
    suiteId: string,
    run: { runId: string; caseId: string },
  ): Promise<readonly CaseExecution[]>;
}

interface ApiRequest<T> {
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly body?: unknown;
}

type ApiCall = <T>(step: string, request: ApiRequest<T>) => Promise<T>;

function createApiCall(config: SarvamTestsConfig): ApiCall {
  const base =
    `${SARVAM_TESTS_BASE}/${encodeURIComponent(config.orgId)}/` +
    `${encodeURIComponent(config.workspaceId)}/test-suites`;
  async function send<T>(request: ApiRequest<T>): Promise<Response> {
    return await config.fetchImpl(`${base}${request.path}`, {
      method: request.body === undefined ? 'GET' : 'POST',
      headers: { 'X-API-Key': config.apiKey, 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
  return async function call<T>(step: string, request: ApiRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      // A dropped connection is waited out like a rate limit: a paid run must not be lost to it.
      const response = await send(request).catch(() => null);
      if (response?.ok) return request.schema.parse(await response.json());
      const status = response?.status ?? NETWORK_DOWN;
      const canWait = status === RATE_LIMITED || status === NETWORK_DOWN;
      if (!canWait || attempt >= MAX_RATE_LIMIT_RETRIES) throw new SarvamTestsError(step, status);
      const seconds = response ? retryAfterSeconds(response) : DEFAULT_RETRY_AFTER_S;
      config.onWait?.(seconds);
      await config.sleep(seconds * 1000);
    }
  };
}

/** Seconds to wait after a 429: the Retry-After header, within sane bounds. */
export function retryAfterSeconds(response: Response): number {
  const stated = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(stated) || stated <= 0) return DEFAULT_RETRY_AFTER_S;
  return Math.min(Math.ceil(stated), MAX_RETRY_AFTER_S);
}

function runBody(agent: AgentVersion, runName: string): Record<string, unknown> {
  return {
    app_id: agent.appId,
    app_version: agent.appVersion,
    frequency: 1,
    run_name: runName,
    on_end_eval: true,
  };
}

function mappingBody(agent: AgentVersion, names: readonly string[]): Record<string, unknown> {
  return {
    app_id: agent.appId,
    app_version: agent.appVersion,
    variable_mapping: Object.fromEntries(names.map((name) => [name, name])),
  };
}

async function listCases(call: ApiCall, suiteId: string): Promise<readonly StoredCase[]> {
  const read = await call('read suite', { path: `/${suiteId}`, schema: SuiteRead });
  return read.test_cases.map((item) => ({
    caseId: item.test_case_id,
    name: item.name,
    variables: new Map((item.variable_overrides ?? []).map((pair) => [pair.name, pair.value])),
  }));
}

export function createSarvamTests(config: SarvamTestsConfig): SarvamTests {
  const call = createApiCall(config);
  return {
    async createSuite(suite) {
      const created = await call('create suite', { path: '', schema: SuiteCreated, body: suite });
      const suiteId = created.test_suite_id;
      const cases = await listCases(call, suiteId);
      return { suiteId, caseIds: new Map(cases.map((item) => [item.name, item.caseId])) };
    },
    listCases: (suiteId) => listCases(call, suiteId),
    async mapVariables(suiteId, agent, names) {
      const body = mappingBody(agent, names);
      await call('map variables', { path: `/${suiteId}/mappings`, schema: z.unknown(), body });
    },
    async startRun(suiteId, agent, runName) {
      const request = {
        path: `/${suiteId}/runs`,
        schema: RunStarted,
        body: runBody(agent, runName),
      };
      return (await call('start run', request)).run_id;
    },
    async getRun(suiteId, runId) {
      const run = await call('read run', { path: `/${suiteId}/runs/${runId}`, schema: RunRead });
      return {
        status: run.status,
        total: run.total_executions,
        completed: run.completed_executions,
      };
    },
    async getCaseResults(suiteId, run) {
      const path = `/${suiteId}/runs/${run.runId}/test-cases/${run.caseId}`;
      const results = await call('read case results', { path, schema: CaseResults });
      return results.executions.map(toExecution);
    },
  };
}
