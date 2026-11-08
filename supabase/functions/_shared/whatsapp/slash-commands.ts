// supabase/functions/_shared/whatsapp/slash-commands.ts
// WhatsApp "/" commands (approved by Saim on 2026-11-08). A message starting with "/" is read
// here, in code, and never goes to the LLM: case-insensitive, trimmed. The words after /paid,
// /add, /asha (alias /reminder) and /statement are kept (a name, or "Ramesh 2000"); after the
// others they are ignored. Anything else starting with "/" is an unknown command (short help).
// SLASH_COMMANDS is also the list `npm run whatsapp:commands` registers on the WhatsApp number
// (Meta conversational automation: names without the slash, English descriptions). No imports,
// so the Node script can read it too.

/** The commands the router runs (an alias maps onto one of these). */
export const SLASH_NAMES = [
  'munshi',
  'menu',
  'pending',
  'due',
  'overdue',
  'paid',
  'add',
  'asha',
  'claims',
  'promises',
  'insights',
  'statement',
] as const;
export type SlashName = (typeof SLASH_NAMES)[number];

/** Other names for a command. */
const ALIASES = { reminder: 'asha' } as const satisfies Readonly<Record<string, SlashName>>;
export type AliasName = keyof typeof ALIASES;
/** Every name registered on the WhatsApp number. */
export type CommandName = SlashName | AliasName;

export interface SlashCommandInfo {
  /** Without the slash, lower case. */
  readonly name: CommandName;
  /** English, at most MAX_COMMAND_DESCRIPTION characters. */
  readonly description: string;
}

/** Meta's limits for conversational automation commands. */
export const MAX_COMMANDS = 30;
export const MAX_COMMAND_NAME = 32;
export const MAX_COMMAND_DESCRIPTION = 256;

/** What the owner sees in WhatsApp's "/" menu, in this order (also the help reply, in English). */
export const SLASH_COMMANDS: readonly SlashCommandInfo[] = [
  { name: 'munshi', description: 'Call Munshi: talk to your book' },
  { name: 'menu', description: 'Open the menu' },
  { name: 'pending', description: 'Who owes you, biggest first' },
  { name: 'due', description: 'Who is due today or overdue, with Remind' },
  { name: 'overdue', description: 'Same as /due: overdue and due today' },
  { name: 'paid', description: 'Record a payment, e.g. /paid Ramesh 2000' },
  { name: 'add', description: 'Add credit, e.g. /add Ramesh 5000 due 15th' },
  { name: 'asha', description: 'Asha reminder call, e.g. /asha Ramesh' },
  { name: 'reminder', description: 'Same as /asha: a reminder call' },
  { name: 'claims', description: 'Payment claims waiting for you to confirm' },
  { name: 'promises', description: 'Promises this week and broken promises' },
  { name: 'insights', description: 'Pie chart, % collected, top 5' },
  { name: 'statement', description: "One shopkeeper's statement, e.g. /statement Ramesh" },
];

export type SlashParse =
  | { readonly kind: 'command'; readonly name: SlashName; readonly rest: string }
  | { readonly kind: 'unknown' };

const SLASH = /^\/([a-z]*)(?![a-z0-9/])\s*([\s\S]*)$/i;

function isSlashName(name: string): name is SlashName {
  return SLASH_NAMES.some((each) => each === name);
}

function isAlias(name: string): name is AliasName {
  return Object.hasOwn(ALIASES, name);
}

/** The "/" command in the message, { kind: 'unknown' } for any other "/…", or null. */
export function parseSlash(text: string): SlashParse | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [, typed = '', after = ''] = SLASH.exec(trimmed) ?? [];
  const word = typed.toLowerCase();
  const name = isAlias(word) ? ALIASES[word] : word;
  if (!isSlashName(name)) return { kind: 'unknown' };
  return { kind: 'command', name, rest: after.trim() };
}
