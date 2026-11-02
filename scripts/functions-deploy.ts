// scripts/functions-deploy.ts
// Uploads function secrets and deploys both Edge Functions. Secrets go through a temporary
// env file (never the command line, never printed), which is deleted straight after.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const FUNCTION_SECRETS = ['VAPI_WEBHOOK_SECRET', 'CORS_ALLOWED_ORIGINS'] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function runSupabase(command: string): void {
  // Only constant strings, the pattern-validated ref and a temp path reach the shell.
  execSync(`npx supabase ${command}`, { stdio: 'inherit' });
}

requireEnv('SUPABASE_ACCESS_TOKEN');
const projectRef = requireEnv('SUPABASE_PROJECT_REF');
if (!PROJECT_REF_PATTERN.test(projectRef))
  throw new Error('SUPABASE_PROJECT_REF has an unexpected format');

const secretsDir = mkdtempSync(join(tmpdir(), 'fn-secrets-'));
const secretsFile = join(secretsDir, 'secrets.env');
try {
  const lines = FUNCTION_SECRETS.map((name) => `${name}=${requireEnv(name)}`);
  writeFileSync(secretsFile, `${lines.join('\n')}\n`, { mode: 0o600 });
  runSupabase(`secrets set --env-file "${secretsFile}" --project-ref ${projectRef}`);
} finally {
  rmSync(secretsDir, { recursive: true, force: true });
}

// Vapi cannot send a Supabase JWT; the webhook checks its own shared-secret header instead.
runSupabase(`functions deploy vapi-webhook --no-verify-jwt --use-api --project-ref ${projectRef}`);
runSupabase(`functions deploy calls-api --use-api --project-ref ${projectRef}`);
process.stdout.write('Functions deployed: vapi-webhook, calls-api\n');
