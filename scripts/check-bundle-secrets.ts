// scripts/check-bundle-secrets.ts
// Quality gate: fails if any server-side secret value appears in the built dashboard (web/dist),
// or if anything of the localhost-only dev token path (ADR-0017 addendum) reached it: the
// /__dev/ endpoint, or a string shaped like a signed dashboard token.
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
  'MUNSHI_LINK_SECRET',
  'SARVAM_OWNER_TOOL_SECRET',
] as const;

/** Must never ship: the dev server's token endpoint and anything that looks like a signed token. */
const DEV_ONLY_PATTERNS = [
  { name: 'dev token endpoint (/__dev/)', pattern: /\/__dev\// },
  { name: 'signed dashboard token', pattern: /\b\d{10}\.[A-Za-z0-9_-]{43}\b/ },
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
  const secretLeaks = secrets
    .filter((secret) => content.includes(secret.value))
    .map((secret) => `${secret.name} in ${file}`);
  const devLeaks = DEV_ONLY_PATTERNS.filter((dev) => dev.pattern.test(content)).map(
    (dev) => `${dev.name} in ${file}`,
  );
  return [...secretLeaks, ...devLeaks];
});

if (leaks.length > 0) {
  process.stdout.write(`SECRET LEAK in bundle:\n${leaks.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `Bundle secret scan passed (${secrets.length} secrets, ${DEV_ONLY_PATTERNS.length} dev-only patterns checked).\n`,
);
