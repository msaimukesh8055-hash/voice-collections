// scripts/check-seed.ts
// Smoke test: confirms the cloud database still holds the seed rows, and that the browser
// (anon key) is blocked from reading customer data (RLS). Seed rows are found by their ids, not
// by table totals, so calls made while testing don't fail the check (CP1 M3); they are counted
// separately for information.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CUSTOMER_IDS = Array.from(
  { length: 8 },
  (_, i) => `c0000000-0000-4000-8000-00000000000${i + 1}`,
);
const LOAN_IDS = Array.from({ length: 8 }, (_, i) => `10000000-0000-4000-8000-00000000000${i + 1}`);
const SEED_CALL_IDS = ['1', '2', '3', '5', '7'].map(
  (n) => `ca000000-0000-4000-8000-00000000000${n}`,
);
const ANITA_ID = 'c0000000-0000-4000-8000-000000000002';

interface SeedCheck {
  readonly label: string;
  readonly table: string;
  readonly expected: number;
  readonly filter: (query: CountQuery) => CountQuery;
}

type CountQuery = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

const SEED_CHECKS: readonly SeedCheck[] = [
  { label: 'customers', table: 'customers', expected: 8, filter: (q) => q.in('id', CUSTOMER_IDS) },
  { label: 'loans', table: 'loans', expected: 8, filter: (q) => q.in('id', LOAN_IDS) },
  { label: 'seeded calls', table: 'calls', expected: 5, filter: (q) => q.in('id', SEED_CALL_IDS) },
  {
    label: 'seeded promises',
    table: 'promises',
    expected: 3,
    filter: (q) => q.in('call_id', SEED_CALL_IDS),
  },
  {
    label: 'seeded notes',
    table: 'customer_notes',
    expected: 5,
    filter: (q) => q.in('call_id', SEED_CALL_IDS),
  },
  {
    label: 'seeded handoffs',
    table: 'handoffs',
    expected: 1,
    filter: (q) => q.in('call_id', SEED_CALL_IDS),
  },
  {
    label: 'seeded payments',
    table: 'payments',
    expected: 2,
    filter: (q) => q.eq('source', 'seed'),
  },
  {
    label: 'seeded followups',
    table: 'followups',
    expected: 1,
    filter: (q) => q.eq('customer_id', ANITA_ID).eq('reason', 'promise_check'),
  },
  { label: 'demo settings', table: 'demo_settings', expected: 1, filter: (q) => q.eq('id', 1) },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function count(admin: SupabaseClient, check: SeedCheck): Promise<number> {
  const query = check.filter(admin.from(check.table).select('*', { count: 'exact', head: true }));
  const { count: total, error } = await query;
  if (error) throw new Error(`Count failed for ${check.table}: ${error.message}`);
  return total ?? 0;
}

async function checkSeedRows(admin: SupabaseClient): Promise<string[]> {
  const failures: string[] = [];
  for (const check of SEED_CHECKS) {
    const actual = await count(admin, check);
    const status = actual === check.expected ? 'ok  ' : 'FAIL';
    process.stdout.write(
      `${status} ${check.label.padEnd(18)} expected ${check.expected}, found ${actual}\n`,
    );
    if (actual !== check.expected) failures.push(check.label);
  }
  return failures;
}

async function reportTestCalls(admin: SupabaseClient): Promise<void> {
  const { count: total } = await admin
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .not('id', 'in', `(${SEED_CALL_IDS.join(',')})`);
  process.stdout.write(`info calls made while testing: ${total ?? 0}\n`);
}

async function checkAnonBlocked(anon: SupabaseClient): Promise<boolean> {
  const { data } = await anon.from('customers').select('id').limit(1);
  const blocked = (data ?? []).length === 0;
  process.stdout.write(`${blocked ? 'ok  ' : 'FAIL'} anon key cannot read customers (RLS)\n`);
  return blocked;
}

const url = requireEnv('SUPABASE_URL');
const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
const anon = createClient(url, requireEnv('SUPABASE_ANON_KEY'));

const failures = await checkSeedRows(admin);
await reportTestCalls(admin);
const anonBlocked = await checkAnonBlocked(anon);

if (failures.length > 0 || !anonBlocked) {
  process.stdout.write('\nSeed check FAILED\n');
  process.exit(1);
}
process.stdout.write('\nSeed check passed\n');
