// supabase/functions/_shared/whatsapp/slash-commands.test.ts
// "/" commands (2026-11-08): read in code only, case-insensitive and trimmed; the words after the
// command are kept for /paid, /add, /asha and /statement; anything else starting with "/" is an
// unknown command (short help). The list registered on the WhatsApp number fits Meta's limits.
import { assert, assertEquals } from '@std/assert';
import {
  MAX_COMMAND_DESCRIPTION,
  MAX_COMMAND_NAME,
  MAX_COMMANDS,
  parseSlash,
  SLASH_COMMANDS,
  SLASH_NAMES,
} from './slash-commands.ts';

Deno.test('slash › a message not starting with "/" is not a command', () => {
  for (const text of ['pending', 'call Munshi', 'Ramesh / Latha', ' ', '']) {
    assertEquals(parseSlash(text), null, text);
  }
});

Deno.test('slash › every command is read, any case, spaces trimmed, nothing after it', () => {
  for (const name of SLASH_NAMES) {
    assertEquals(parseSlash(`/${name}`), { kind: 'command', name, rest: '' });
    assertEquals(parseSlash(`  /${name.toUpperCase()}  `), { kind: 'command', name, rest: '' });
  }
});

Deno.test('slash › /reminder is /asha', () => {
  assertEquals(parseSlash('/Reminder Ramesh'), { kind: 'command', name: 'asha', rest: 'Ramesh' });
});

Deno.test('slash › the words after the command are kept as typed, trimmed', () => {
  assertEquals(parseSlash('/paid  Ramesh 2000 '), {
    kind: 'command',
    name: 'paid',
    rest: 'Ramesh 2000',
  });
  assertEquals(parseSlash('/ADD Latha 5000 due 15th'), {
    kind: 'command',
    name: 'add',
    rest: 'Latha 5000 due 15th',
  });
  assertEquals(parseSlash('/statement\nPraveen Bakery'), {
    kind: 'command',
    name: 'statement',
    rest: 'Praveen Bakery',
  });
  assertEquals(parseSlash('/pending.'), { kind: 'command', name: 'pending', rest: '.' });
});

Deno.test('slash › an unknown or empty command is unknown', () => {
  for (const text of ['/xyz', '/', '/ pending', '/pendingx', '/123', '//menu']) {
    assertEquals(parseSlash(text), { kind: 'unknown' }, text);
  }
});

Deno.test("slash › the registered list fits Meta's limits and covers every name", () => {
  assert(SLASH_COMMANDS.length <= MAX_COMMANDS);
  const names = SLASH_COMMANDS.map((command) => command.name);
  assertEquals(new Set(names).size, names.length);
  for (const command of SLASH_COMMANDS) {
    assert(/^[a-z]+$/.test(command.name), command.name);
    assert(command.name.length <= MAX_COMMAND_NAME, command.name);
    assert(command.description.length > 0, command.name);
    assert(command.description.length <= MAX_COMMAND_DESCRIPTION, command.name);
  }
  for (const name of SLASH_NAMES) assert(names.includes(name), name);
  assert(names.includes('reminder'));
});
