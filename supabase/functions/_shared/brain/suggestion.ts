// supabase/functions/_shared/brain/suggestion.ts
// The one JSON object the LLM may return (M4 Decision 3), checked with Zod. A suggestion is only
// ever turned into a Command: a read, or a confirmation card the owner must tap Save on. Nothing
// here (or anywhere on the LLM path) writes to the database.
import { z } from 'zod';
import { extractJson } from '../llm/json-llm.ts';
import { MAX_AMOUNT } from './amounts.ts';
import type { Command } from './commands.ts';

const MAX_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 60;

/** Names must come back in English letters (the prompt asks the LLM to transliterate). */
const Name = z.string().trim().min(1).max(MAX_NAME_LENGTH).regex(/^[A-Za-z][A-Za-z .'-]*$/);
const Amount = z.number().positive().max(MAX_AMOUNT);

export const SuggestionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('ledger_query'),
    query: z.enum(['pending', 'closed', 'shopkeeper']),
    name: Name.nullish(),
  }),
  z.object({
    intent: z.literal('add_credit'),
    name: Name,
    amount: Amount,
    due_date: z.iso.date().nullish(),
    note: z.string().trim().max(MAX_NOTE_LENGTH).nullish(),
  }),
  z.object({ intent: z.literal('mark_paid'), name: Name, amount: Amount }),
  z.object({ intent: z.literal('help') }),
  z.object({ intent: z.literal('unknown') }),
]);

export type Suggestion = z.infer<typeof SuggestionSchema>;

function titleCase(name: string): string {
  return name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Text → suggestion; tolerates code fences and stray words around the one JSON object. */
export function parseSuggestion(content: string): Suggestion | null {
  return extractJson(content, SuggestionSchema);
}

type Intent = Suggestion['intent'];
type ToCommand<I extends Intent> = (
  suggestion: Extract<Suggestion, { intent: I }>,
  today: string,
) => Command | null;

/** One entry per intent. A due date in the past is dropped, so the card shows the 15-day
 * default instead of an already-overdue credit. */
const TO_COMMAND: { readonly [I in Intent]: ToCommand<I> } = {
  help: () => ({ kind: 'help' }),
  unknown: () => null,
  mark_paid: (s) => ({ kind: 'mark_paid', name: titleCase(s.name), amount: s.amount }),
  add_credit: (s, today) => {
    const due = s.due_date ?? null;
    return {
      kind: 'add_credit',
      name: titleCase(s.name),
      amount: s.amount,
      dueDate: due !== null && due >= today ? due : null,
      note: s.note || null,
    };
  },
  ledger_query: (s) => {
    if (s.query !== 'shopkeeper') return { kind: s.query };
    return s.name ? { kind: 'lookup', name: titleCase(s.name) } : null;
  },
};

/** The command a suggestion stands for; null = "didn't get that". */
export function toCommand(suggestion: Suggestion, today: string): Command | null {
  const convert = TO_COMMAND[suggestion.intent] as ToCommand<Intent>;
  return convert(suggestion, today);
}
