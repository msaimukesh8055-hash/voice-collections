// supabase/functions/_shared/brain/commands.ts
// Fixed commands, parsed in code before any LLM (ADR-0014): help, pending, closed, insights,
// dashboard, a shopkeeper
// name, "X paid N" and "X N due D", in English and in Latin-letter Hindi and Telugu. Names,
// amounts and dates are cut out of the text itself; nothing is guessed. Anything else returns
// null and goes to the LLM.
import { findAmount } from './amounts.ts';
import { findDueDate } from './dates.ts';
import { hasIndicScript } from './language.ts';

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'lookup'; readonly name: string }
  | {
    readonly kind: 'add_credit';
    readonly name: string;
    readonly amount: number;
    /** null = not said; the card uses the 15-day default. */
    readonly dueDate: string | null;
    readonly note: string | null;
  }
  | { readonly kind: 'mark_paid'; readonly name: string; readonly amount: number }
  // M5 5b: the due alert, reminders and the score explained.
  | { readonly kind: 'due_alert' }
  | { readonly kind: 'remind'; readonly name: string }
  | { readonly kind: 'remind_all' }
  | { readonly kind: 'score'; readonly name: string }
  // M6: insights (pie chart, % collected, top 5) and the web dashboard link.
  | { readonly kind: 'insights' }
  | { readonly kind: 'dashboard' };

export type CommandKind = Command['kind'];

const MAX_NAME_WORDS = 4;
const MAX_NOTE_LENGTH = 60;

const HELP = new Set([
  'hi',
  'hello',
  'hey',
  'help',
  'menu',
  'start',
  'namaste',
  'namaskar',
  'namaskaram',
  'help me',
  'నమస్కారం',
  'హలో',
  'नमस्ते',
  'हेलो',
  'हेल्प',
]);
const PENDING = new Set([
  'pending',
  'dues',
  'due list',
  'pending list',
  'who owes',
  'who owes me',
  'baki',
  'baaki',
  'bakaya',
  'baaki list',
  'udhaar list',
  'bakilu',
  'pending dues',
]);
const CLOSED = new Set(['closed', 'paid off', 'cleared', 'settled', 'closed list', 'chukta']);
/** "who is due?" / "who is overdue?" and the template's "Reply DUE" (M5 Decision 7). "dues"
 * stays "pending". */
/** "insights" / "report" (SPEC §6.6); also in Telugu and Hindi script, like the greetings. */
const INSIGHTS = new Set([
  'insights',
  'insight',
  'report',
  'reports',
  'monthly report',
  'collection report',
  'stats',
  'summary',
  'report dikhao',
  'report chupinchu',
  'రిపోర్ట్',
  'रिपोर्ट',
]);
const DASHBOARD = new Set(['dashboard', 'dashboard link', 'open dashboard', 'web', 'website']);
const DUE_ALERT = new Set([
  'due',
  'due today',
  'who is due',
  'who is due today',
  'whos due',
  'due alert',
  'aaj due',
  'aaj ka due',
  'aaj kiska due hai',
  'kiska due hai',
  'eevala due',
  'ivala due',
  'evaru due',
  // M6: "overdue" asks for the same alert (it lists overdue people too).
  'overdue',
  'overdue list',
  'who is overdue',
  'whos overdue',
  "who's overdue",
  'who’s overdue',
  'who all are overdue',
  'show overdue',
]);
const REMIND_ALL = new Set([
  'remind all',
  'remind all due',
  'remind everyone',
  'remind everybody',
  'remind everyone due',
  'sabko remind',
  'sabko yaad dilao',
  'andariki remind',
]);
const REMIND_PREFIX = /^remind ([a-z ]+)$/;
/** "why is Ramesh 42", "why is ramesh's score 42", "Ramesh score", "score of Ramesh". */
const SCORE_PATTERNS = [
  /^why (?:is|does) ([a-z ]+?) (?:score |have |has |a |only |at )*\d{1,3}$/,
  /^([a-z ]+?) score$/,
  /^score (?:of |for )?([a-z ]+)$/,
];

/** Words meaning "he paid" (English, Hindi, Telugu in Latin letters). */
const PAID_WORDS = new Set([
  'paid',
  'pay',
  'payed',
  'payment',
  'received',
  'recd',
  'got',
  'returned',
  'repaid',
  'jama',
  'chukaya',
  'chukaye',
  'bhare',
  'kattadu',
  'kattindi',
  'kattaru',
  'kattesadu',
  'ichadu',
  'icchadu',
  'ichindi',
  'icchindi',
  'ichaadu',
  'chellinchadu',
]);
/** Hindi "X ne N diye" = X paid N; "X ko N diye" = gave X goods on credit. */
const HINDI_GAVE = new Set(['diye', 'diya', 'de', 'di']);
const HINDI_PAYER_MARK = 'ne';
/** Words that mean "credit" or join the sentence; they are not part of a name or a note. */
const FILLER_WORDS = new Set([
  'credit',
  'udhaar',
  'udhar',
  'udaar',
  'udhaari',
  'appu',
  'baaki',
  'baki',
  'loan',
  'gave',
  'given',
  'give',
  'icchanu',
  'ichanu',
  'add',
  'new',
  'entry',
  'ne',
  'ko',
  'ki',
  'ku',
  'ke',
  'ka',
  'se',
  'garu',
  'gaaru',
  'from',
  'to',
  'for',
  'of',
  'has',
  'have',
  'me',
  'mein',
  'rs',
  'rupees',
  'rupaye',
  'due',
  'by',
  'on',
  'and',
  'diye',
  'diya',
  'de',
  'di',
  'is',
  'the',
  'a',
  'goods',
  'maal',
  'saman',
  'nundi',
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/,(?!\d)/g, ' ')
    .replace(/[!?;:]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return text.split(' ').filter((word) => /^[a-z]+$/.test(word));
}

function titleCase(name: readonly string[]): string {
  return name.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function cutOut(text: string, span: { start: number; end: number } | null): string {
  return span ? `${text.slice(0, span.start)} ${text.slice(span.end)}` : text;
}

function isPaid(all: readonly string[]): boolean {
  if (all.some((word) => PAID_WORDS.has(word))) return true;
  return all.includes(HINDI_PAYER_MARK) && all.some((word) => HINDI_GAVE.has(word));
}

function isNameWord(word: string): boolean {
  return !PAID_WORDS.has(word) && !FILLER_WORDS.has(word);
}

function lookupOf(text: string): Command | null {
  const all = text.split(' ');
  const nameWords = words(text);
  if (nameWords.length !== all.length || all.length > MAX_NAME_WORDS) return null;
  return { kind: 'lookup', name: titleCase(nameWords) };
}

function entryOf(text: string, today: string): Command | null {
  const due = findDueDate(text, today);
  const rest = cutOut(text, due);
  const amount = findAmount(rest);
  if (!amount) return null;
  const before = words(rest.slice(0, amount.start)).filter(isNameWord);
  const after = words(rest.slice(amount.end)).filter(isNameWord);
  const name = before.length > 0 ? before : after;
  if (name.length === 0 || name.length > MAX_NAME_WORDS) return null;
  const all = words(rest);
  if (isPaid(all)) return { kind: 'mark_paid', name: titleCase(name), amount: amount.amount };
  const note = before.length > 0 && after.length > 0 ? after.join(' ') : null;
  return {
    kind: 'add_credit',
    name: titleCase(name),
    amount: amount.amount,
    dueDate: due?.date ?? null,
    note: note === null ? null : note.slice(0, MAX_NOTE_LENGTH),
  };
}

/** A name of 1–4 Latin-letter words, title-cased; null otherwise. */
function nameOf(text: string | undefined): string | null {
  const all = (text ?? '').trim().split(' ');
  const nameWords = words(all.join(' '));
  if (nameWords.length === 0 || nameWords.length !== all.length) return null;
  return nameWords.length > MAX_NAME_WORDS ? null : titleCase(nameWords);
}

function reminderOf(text: string): Command | null {
  if (DUE_ALERT.has(text)) return { kind: 'due_alert' };
  if (REMIND_ALL.has(text)) return { kind: 'remind_all' };
  const name = nameOf(REMIND_PREFIX.exec(text)?.[1]);
  return name ? { kind: 'remind', name } : null;
}

function scoreOf(text: string): Command | null {
  // "Ramesh's score" → "ramesh score".
  const plain = text.replace(/['’]s\b/g, '');
  for (const pattern of SCORE_PATTERNS) {
    const name = nameOf(pattern.exec(plain)?.[1]);
    if (name) return { kind: 'score', name };
  }
  return null;
}

/** A fixed command, or null when only the LLM can read the message. */
export function parseCommand(text: string, today: string): Command | null {
  const clean = normalise(text);
  if (HELP.has(clean)) return { kind: 'help' };
  if (INSIGHTS.has(clean)) return { kind: 'insights' };
  if (DASHBOARD.has(clean)) return { kind: 'dashboard' };
  if (hasIndicScript(clean)) return null;
  if (PENDING.has(clean)) return { kind: 'pending' };
  if (CLOSED.has(clean)) return { kind: 'closed' };
  return reminderOf(clean) ?? scoreOf(clean) ?? entryOf(clean, today) ?? lookupOf(clean);
}
