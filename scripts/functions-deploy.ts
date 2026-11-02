// scripts/functions-deploy.ts
// Uploads function secrets and deploys both Edge Functions to the project in .env (Mumbai).
// Secrets go through a temporary env file (never the command line, never printed), which is
// deleted straight after. --yes: Saim approved hosted deploys for M3.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const REQUIRED_SECRETS = [
  'SARVAM_AGENTS_API_KEY',
  'SARVAM_TOOL_SECRET',
  'SARVAM_ORG_ID',
  'SARVAM_WORKSPACE_ID',
  'CORS_ALLOWED_ORIGINS',
] as const;
/** Blank until Asha exists in Sarvam; calls-api refuses calls (503) until it is set. */
const OPTIONAL_SECRETS = ['SARVAM_APP_ID'] as const;

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function runSupabase(command: string): void {
  // Only constant strings, the pattern-validated ref and a temp path reach the shell.
  execSync(`npx supabase ${command}`, { stdio: 'inherit' });
}

function secretLines(): string[] {
  const required = REQUIRED_SECRETS.map((name) => `${name}=${requireEnv(name)}`);
  const optional = OPTIONAL_SECRETS.filter((name) => readEnv(name) !== '').map(
    (name) => `${name}=${readEnv(name)}`,
  );
  return [...required, ...optional];
}

requireEnv('SUPABASE_ACCESS_TOKEN');
const projectRef = requireEnv('SUPABASE_PROJECT_REF');
if (!PROJECT_REF_PATTERN.test(projectRef))
  throw new Error('SUPABASE_PROJECT_REF has an unexpected format');

const secretsDir = mkdtempSync(join(tmpdir(), 'fn-secrets-'));
const secretsFile = join(secretsDir, 'secrets.env');
try {
  const lines = secretLines();
  writeFileSync(secretsFile, `${lines.join('\n')}\n`, { mode: 0o600 });
  runSupabase(`secrets set --env-file "${secretsFile}" --project-ref ${projectRef} --yes`);
  const names = lines.map((line) => line.slice(0, line.indexOf('=')));
  process.stdout.write(`Secrets set: ${names.join(', ')}\n`);
} finally {
  rmSync(secretsDir, { recursive: true, force: true });
}

// Sarvam cannot send a Supabase JWT; sarvam-tools checks its own bearer secret instead.
runSupabase(
  `functions deploy sarvam-tools --no-verify-jwt --use-api --project-ref ${projectRef} --yes`,
);
runSupabase(`functions deploy calls-api --use-api --project-ref ${projectRef} --yes`);
process.stdout.write('Functions deployed: sarvam-tools, calls-api\n');
