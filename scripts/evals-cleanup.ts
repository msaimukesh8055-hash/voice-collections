// scripts/evals-cleanup.ts
// npm run evals:cleanup            list what would be deleted (dry run, the default)
// npm run evals:cleanup -- --yes   delete it
// Deletes old eval data (M9 Build F): every eval owner except the newest run per agent, with all
// its rows, through the database function delete_eval_owner, which refuses any owner not flagged
// is_eval and deletes one owner per transaction. The real owner's book is never read for
// deletion. Stored scores (eval_runs, eval_results) are kept, so the Evals page keeps its trend.
// Test suites in Sarvam are not deleted (no delete call is used); the old suite ids are listed.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Prints ids and counts only.
import { z } from 'zod';
import { requireEnv } from './lib/smoke.ts';
import { type EvalOwnerRow, planCleanup } from './lib/eval-cleanup.ts';

const OwnerRows = z.array(
  z.object({
    id: z.string(),
    is_eval: z.boolean(),
    eval_agent: z.string().nullable(),
    eval_run: z.string().nullable(),
    created_at: z.string(),
  }),
);
const RunRows = z.array(
  z.object({ target: z.string(), metrics: z.record(z.string(), z.unknown()) }),
);

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function client(): (path: string, init?: RequestInit) => Promise<unknown> {
  const base = `${requireEnv('SUPABASE_URL').replace(/\/+$/, '')}/rest/v1/`;
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return async function request(path, init = {}): Promise<unknown> {
    const response = await fetch(base + path, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${path.split('?')[0]} failed (HTTP ${response.status})`,
      );
    const text = await response.text();
    return text === '' ? null : JSON.parse(text);
  };
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--yes');
  const request = client();
  const rows = OwnerRows.parse(
    await request(
      'owners?select=id,is_eval,eval_agent,eval_run,created_at&is_eval=eq.true&order=created_at',
    ),
  );
  const owners: EvalOwnerRow[] = rows.map((row) => ({
    id: row.id,
    isEval: row.is_eval,
    evalAgent: row.eval_agent,
    evalRun: row.eval_run,
    createdAt: row.created_at,
  }));
  const plan = planCleanup(owners);
  write(
    `Eval owners: ${owners.length}. Keeping ${plan.keepIds.length}, deleting ${plan.deleteIds.length}.`,
  );
  for (const [agent, run] of plan.kept) write(`  kept for ${agent}: run ${run}`);

  const runs = RunRows.parse(
    await request('eval_runs?select=target,metrics&order=created_at.desc'),
  );
  const suites = runs
    .filter((run) => run.metrics['kind'] === 'sarvam-tests')
    .map((run) => `${run.target} ${String(run.metrics['suiteId'] ?? '?')}`);
  write(
    `Sarvam test suites on record (remove old ones in the Sarvam console if wanted): ${suites.length}`,
  );
  for (const suite of suites) write(`  ${suite}`);

  if (!confirmed) {
    write('Dry run: nothing deleted. Add -- --yes to delete.');
    return;
  }
  let done = 0;
  for (const ownerId of plan.deleteIds) {
    await request('rpc/delete_eval_owner', {
      method: 'POST',
      body: JSON.stringify({ target: ownerId }),
    });
    done += 1;
  }
  write(`Deleted ${done} eval owners and their rows.`);
}

await main();
