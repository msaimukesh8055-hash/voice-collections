// scripts/whatsapp-commands.ts
// npm run whatsapp:commands -- --dry   prints the payload; no network, no secrets needed
// npm run whatsapp:commands            sets the "/" commands on the Meta WhatsApp number
// Reads META_ACCESS_TOKEN and META_PHONE_NUMBER_ID from .env. Never prints the token.
import { commandsPayload, commandsUrl, registerCommands } from './lib/whatsapp-commands.ts';
import { requireEnv } from './lib/smoke.ts';

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const payload = commandsPayload();
  if (process.argv.includes('--dry')) {
    say(`Dry run: POST ${commandsUrl('{META_PHONE_NUMBER_ID}')} with:`);
    say(JSON.stringify(payload, null, 2));
    return 0;
  }
  await registerCommands({
    fetchImpl: fetch,
    token: requireEnv('META_ACCESS_TOKEN'),
    phoneNumberId: requireEnv('META_PHONE_NUMBER_ID'),
  });
  say(
    `ok   ${payload.commands.length} commands set: ` +
      payload.commands.map((command) => `/${command.command_name}`).join(' '),
  );
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
