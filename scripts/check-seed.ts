// scripts/check-seed.ts
// Smoke test: confirms the cloud database holds the expected seed rows,
// and that the browser (anon key) is blocked from reading customer data (RLS).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  customers: 8,
  loans: 8,
  calls: 5,
  promises: 3,
  payments: 2,
  customer_notes: 5,
  handoffs: 1,
  followups: 1,
  demo_settings: 1,
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Count failed for ${table}: ${error.message}`);
  return count ?? 0;
}

async function checkCounts(admin: SupabaseClient): Promise<string[]> {
  const failures: string[] = [];
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = await countRows(admin, table);
    const status = actual === expected ? 'ok  ' : 'FAIL';
    process.stdout.write(`${status} ${table.padEnd(16)} expected ${expected}, found ${actual}\n`);
    if (actual !== expected) failures.push(table);
  }
  return failures;
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

const failures = await checkCounts(admin);
const anonBlocked = await checkAnonBlocked(anon);

if (failures.length > 0 || !anonBlocked) {
  process.stdout.write('\nSeed check FAILED\n');
  process.exit(1);
}
process.stdout.write('\nSeed check passed\n');
