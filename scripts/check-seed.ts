// scripts/check-seed.ts
// Smoke test of the deployed database (npm run db:check-seed): every table exists, the seed rows
// are there (counts come from the generator itself, so they cannot drift), Ramesh's figures are
// right, and the browser (anon key) is blocked from every table. Prints counts and fake demo
// figures only; never keys.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { istDate } from '../supabase/functions/_shared/clock.ts';
import { computeDues } from '../supabase/functions/_shared/ledger/dues.ts';
import { LedgerEntrySchema } from '../supabase/functions/_shared/schemas/ledger.ts';
import { generateSeed, shopkeeperId } from './seed/generate-seed.ts';
import { OWNER } from './seed/names.ts';
import { RAMESH_STORY } from './seed/ramesh.ts';

const TABLES = [
  'owners',
  'shopkeepers',
  'calls',
  'ledger_entries',
  'promises',
  'tool_events',
  'shopkeeper_notes',
  'followup_runs',
  'followups',
  'eval_runs',
  'eval_results',
  'publishes',
  'demo_settings',
  'balances',
] as const;

type CountQuery = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

interface SeedCheck {
  readonly label: string;
  readonly table: string;
  readonly expected: number;
  readonly filter: (query: CountQuery) => CountQuery;
}

const seed = generateSeed();
const RAMESH_ID = shopkeeperId(0);

const SEED_CHECKS: readonly SeedCheck[] = [
  { label: 'owner', table: 'owners', expected: 1, filter: (q) => q.eq('id', OWNER.id) },
  {
    label: 'shopkeepers',
    table: 'shopkeepers',
    expected: seed.shopkeepers.length,
    filter: (q) => q.eq('owner_id', OWNER.id),
  },
  {
    label: 'seeded ledger entries',
    table: 'ledger_entries',
    expected: seed.entries.length,
    filter: (q) => q.eq('source', 'seed'),
  },
  {
    label: 'seeded promises',
    table: 'promises',
    expected: seed.promises.length,
    filter: (q) => q.is('call_id', null),
  },
  {
    label: 'live shopkeeper = Ramesh',
    table: 'demo_settings',
    expected: 1,
    filter: (q) => q.eq('live_shopkeeper_id', RAMESH_ID),
  },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function report(passed: boolean, line: string): boolean {
  process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${line}\n`);
  return passed;
}

async function count(admin: SupabaseClient, check: SeedCheck): Promise<number> {
  const query = check.filter(admin.from(check.table).select('*', { count: 'exact', head: true }));
  const { count: total, error } = await query;
  if (error) throw new Error(`Count failed for ${check.table} (${error.code})`);
  return total ?? 0;
}

async function checkTablesExist(admin: SupabaseClient): Promise<boolean> {
  const results = await Promise.all(
    TABLES.map(
      async (table) => (await admin.from(table).select('*', { head: true })).error === null,
    ),
  );
  const missing = TABLES.filter((_, index) => !results[index]);
  return report(
    missing.length === 0,
    `all ${TABLES.length} tables/views exist${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`,
  );
}

async function checkSeedRows(admin: SupabaseClient): Promise<boolean> {
  let passed = true;
  for (const check of SEED_CHECKS) {
    const actual = await count(admin, check);
    passed =
      report(
        actual === check.expected,
        `${check.label.padEnd(26)} expected ${check.expected}, found ${actual}`,
      ) && passed;
  }
  return passed;
}

async function checkRamesh(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from('ledger_entries')
    .select('kind,amount,entry_date,due_date,status')
    .eq('shopkeeper_id', RAMESH_ID)
    .limit(500);
  if (error) throw new Error(`Ledger read failed (${error.code})`);
  const entries = (data ?? []).map((row) =>
    LedgerEntrySchema.parse({
      kind: row.kind,
      amount: row.amount,
      entryDate: row.entry_date,
      dueDate: row.due_date,
      status: row.status,
    }),
  );
  const today = istDate(new Date());
  const dues = computeDues(entries, today);
  const figures = `outstanding ₹${dues.outstanding}, overdue ₹${dues.overdueAmount} since ${dues.oldestDueDate} (${dues.daysOverdue} days), next ₹${dues.nextDueAmount} on ${dues.nextDueDate}`;
  const matches =
    dues.outstanding === RAMESH_STORY.outstanding &&
    dues.overdueAmount === RAMESH_STORY.overdueAmount;
  return report(matches, `Ramesh (today ${today}): ${figures}`);
}

async function checkAnonBlocked(anon: SupabaseClient): Promise<boolean> {
  const readable: string[] = [];
  for (const table of TABLES) {
    const { data } = await anon.from(table).select('*').limit(1);
    if ((data ?? []).length > 0) readable.push(table);
  }
  return report(
    readable.length === 0,
    `anon key reads nothing from any table (RLS)${readable.length ? `: ${readable.join(', ')}` : ''}`,
  );
}

const url = requireEnv('SUPABASE_URL');
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
const anon = createClient(url, requireEnv('SUPABASE_ANON_KEY'));

const results = [
  await checkTablesExist(admin),
  await checkSeedRows(admin),
  await checkRamesh(admin),
  await checkAnonBlocked(anon),
];

if (results.includes(false)) {
  process.stdout.write('\nSeed check FAILED\n');
  process.exit(1);
}
process.stdout.write('\nSeed check passed\n');
