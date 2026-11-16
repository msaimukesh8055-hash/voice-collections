// evals/sarvam/munshi-eval-db.ts
// The Munshi Sarvam-Tests runner's database access (M9 Build F, service role): insert each
// case's eval owner and fake book, read what a case left behind, and end the owner calls so
// their tokens stop working. It only inserts new rows, reads, and updates owner calls it
// created itself by id; it never deletes (that is `npm run evals:cleanup`).
import { z } from 'zod';
import { createRequest, type DbRequest, type EvalDbConfig, insert } from './eval-db.ts';
import type { MunshiEvidence } from './munshi-checks.ts';
import type { MunshiCaseRows, MunshiEvalRows } from './munshi-eval-data.ts';

const ToolRows = z.array(z.object({ tool: z.string(), result: z.object({ ok: z.boolean() }) }));
const EntryRows = z.array(
  z.object({
    id: z.string(),
    shopkeeper_id: z.string(),
    kind: z.enum(['credit', 'payment']),
    amount: z.coerce.number(),
    status: z.string(),
  }),
);
const ActionRows = z.array(
  z.object({ kind: z.string(), payload: z.record(z.string(), z.unknown()) }),
);

export interface MunshiEvalDb {
  insertRows(rows: MunshiEvalRows): Promise<void>;
  readEvidence(rows: MunshiCaseRows): Promise<MunshiEvidence>;
  /** Ends the run's owner calls so their tokens stop working. */
  closeOwnerCalls(ownerCallIds: readonly string[], endedAt: Date): Promise<void>;
}

async function insertRows(request: DbRequest, rows: MunshiEvalRows): Promise<void> {
  // Parents before children: owners, shopkeepers, past calls, then what points at them.
  await insert(request, 'owners', rows.owners);
  await insert(request, 'shopkeepers', rows.shopkeepers);
  await insert(request, 'calls', rows.calls);
  await Promise.all([
    insert(request, 'ledger_entries', rows.entries),
    insert(request, 'promises', rows.promises),
    insert(request, 'followups', rows.followups),
    insert(request, 'owner_calls', rows.ownerCalls),
  ]);
}

async function readEvidence(request: DbRequest, rows: MunshiCaseRows): Promise<MunshiEvidence> {
  const call = encodeURIComponent(rows.ownerCallId);
  const owner = encodeURIComponent(rows.ownerId);
  const [tools, entries, actions] = await Promise.all([
    request(
      'read owner tools',
      `owner_tool_events?select=tool,result&owner_call_id=eq.${call}&order=created_at`,
    ),
    request(
      'read entries',
      'ledger_entries?select=id,shopkeeper_id,kind,amount,status,shopkeepers!inner(owner_id)' +
        `&shopkeepers.owner_id=eq.${owner}&limit=1000`,
    ),
    request(
      'read saved actions',
      `pending_actions?select=kind,payload&owner_call_id=eq.${call}&status=eq.saved`,
    ),
  ]);
  return {
    tools: ToolRows.parse(tools).map((row) => ({ tool: row.tool, ok: row.result.ok })),
    entries: EntryRows.parse(entries).map((row) => ({
      id: row.id,
      shopkeeperId: row.shopkeeper_id,
      kind: row.kind,
      amount: row.amount,
      status: row.status,
    })),
    savedActions: ActionRows.parse(actions),
  };
}

export function createMunshiEvalDb(config: EvalDbConfig): MunshiEvalDb {
  const request = createRequest(config);
  return {
    insertRows: (rows) => insertRows(request, rows),
    readEvidence: (rows) => readEvidence(request, rows),
    async closeOwnerCalls(ownerCallIds, endedAt) {
      if (ownerCallIds.length === 0) return;
      const list = ownerCallIds.map(encodeURIComponent).join(',');
      await request(
        'close owner calls',
        `owner_calls?id=in.(${list})&status=in.(accepted,in_progress)`,
        {
          method: 'PATCH',
          body: { status: 'completed', ended_at: endedAt.toISOString() },
          prefer: 'return=minimal',
        },
      );
    },
  };
}
