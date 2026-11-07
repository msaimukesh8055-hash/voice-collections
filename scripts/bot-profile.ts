// scripts/bot-profile.ts
// npm run bot:profile -- --dry-run   prints what would be sent; no network, no secrets needed
// npm run bot:profile                sets the logo, About, description, category and website on
//                                    the Meta test number, then prints what Meta now has
// Reads META_ACCESS_TOKEN, META_PHONE_NUMBER_ID and META_APP_ID from .env (META_APP_ID: App
// dashboard → App settings → Basic → App ID; not secret). DASHBOARD_URL, if it is an https
// address, becomes the profile's website. Never prints the token. Run `npm run brand:png` first.
// If Meta refuses on a test number, the printed code goes into the M7 Results (Decision 6).
import { readFileSync } from 'node:fs';
import { logoProblem, profilePayload, profileText, setBotProfile } from './lib/bot-profile.ts';
import { requireEnv } from './lib/smoke.ts';

const LOGO_PATH = 'web/public/brand/logo-640.png';

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function website(): string | null {
  return process.env['DASHBOARD_URL']?.replace(/\r/g, '').trim() || null;
}

async function main(): Promise<number> {
  const png = new Uint8Array(readFileSync(LOGO_PATH));
  const problem = logoProblem(png);
  if (problem) {
    say(`FAIL ${problem} (${LOGO_PATH}); run npm run brand:png`);
    return 1;
  }
  const text = profileText(website());
  if (process.argv.includes('--dry-run')) {
    say(`Dry run: logo ${LOGO_PATH} (${png.byteLength} bytes, 640×640) and this profile:`);
    say(JSON.stringify(profilePayload(text, null), null, 2));
    return 0;
  }
  const profile = await setBotProfile({
    fetchImpl: fetch,
    token: requireEnv('META_ACCESS_TOKEN'),
    phoneNumberId: requireEnv('META_PHONE_NUMBER_ID'),
    appId: requireEnv('META_APP_ID'),
    png,
    text,
  });
  say('ok   profile set. Meta now has:');
  say(JSON.stringify(profile.data[0], null, 2));
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // MetaStepError carries status and code only; requireEnv names the missing variable.
    say(`FAIL ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  },
);
