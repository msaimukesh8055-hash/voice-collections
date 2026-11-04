// scripts/check-bundle-secrets.ts
// Quality gate: fails if any server-side secret value appears in the built dashboard (web/dist).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = 'web/dist';
const SECRET_NAMES = [
  'GEMINI_API_KEY',
  'SARVAM_API_KEY',
  'SARVAM_AGENTS_API_KEY',
  'SARVAM_TOOL_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ACCESS_TOKEN',
  'META_ACCESS_TOKEN',
  'META_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'OWNER_WHATSAPP_NUMBER',
  'WORKER_SECRET',
  'DASHBOARD_LINK_SECRET',
] as const;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(function expand(name) {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function presentSecrets(): { name: string; value: string }[] {
  return SECRET_NAMES.map(function toEntry(name) {
    return { name, value: process.env[name]?.trim() ?? '' };
  }).filter(function hasValue(entry) {
    return entry.value.length > 0;
  });
}

const secrets = presentSecrets();
const leaks = listFiles(DIST_DIR).flatMap(function scan(file) {
  const content = readFileSync(file, 'utf8');
  return secrets
    .filter((secret) => content.includes(secret.value))
    .map((secret) => `${secret.name} in ${file}`);
});

if (leaks.length > 0) {
  process.stdout.write(`SECRET LEAK in bundle:\n${leaks.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Bundle secret scan passed (${secrets.length} secrets checked).\n`);
