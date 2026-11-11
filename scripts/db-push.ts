// scripts/db-push.ts
// Links the Supabase CLI to the project and applies migrations. The seed (which wipes the demo
// data) runs only with --reseed-wipes-demo-data.
// Reads secrets from .env (via `node --env-file`); passes them as env vars, never as printed output.
import { execSync } from 'node:child_process';

const REQUIRED = ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'SUPABASE_ACCESS_TOKEN'] as const;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function runSupabase(command: string): void {
  // Only constant strings and the pattern-validated project ref reach the shell.
  execSync(`npx supabase ${command}`, { stdio: 'inherit' });
}

REQUIRED.forEach(requireEnv);
const projectRef = requireEnv('SUPABASE_PROJECT_REF');
if (!PROJECT_REF_PATTERN.test(projectRef))
  throw new Error('SUPABASE_PROJECT_REF has an unexpected format');

// The CLI reads SUPABASE_DB_PASSWORD and SUPABASE_ACCESS_TOKEN from the environment (.env).
runSupabase(`link --project-ref ${projectRef}`);
// M9: migrations only by default. The seed starts with "truncate ... cascade" and wipes every
// call, promise and ledger entry made since, so it runs only when asked for by name.
const RESEED_FLAG = '--reseed-wipes-demo-data';
const reseed = process.argv.includes(RESEED_FLAG);
runSupabase(`db push --linked ${reseed ? '--include-seed ' : ''}--yes`);
if (!reseed) {
  process.stdout.write(`Migrations pushed; seed not run (pass ${RESEED_FLAG} to wipe and reseed).
`);
}
