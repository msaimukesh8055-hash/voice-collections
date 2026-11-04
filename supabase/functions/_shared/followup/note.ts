// supabase/functions/_shared/followup/note.ts
// The note Asha reads on her next call (SPEC §8.4, M5 Decision 4): always written. With a
// transcript, the LLM writes 1–2 lines (NOTE_PROMPT, checked JSON); without one, or if both
// providers fail, the note is built in code from what the call recorded. Either way it is cleaned
// to one short line (memory.ts) before it is stored.
import { z } from 'zod';
import { cleanNote, toNoteLine } from '../calls/memory.ts';
import { formatInr, formatShortDay } from '../format.ts';
import { extractJson, type JsonLlm } from '../llm/json-llm.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { inOwnerScript } from './agent.ts';
import type { CallFacts } from './facts.ts';
import { describeCallForLlm, NOTE_PROMPT } from './prompts.ts';
import { outcomeOf } from './rules.ts';
import type { SaidSummary } from './summary.ts';

export const NOTE_EVENT = 'followup_note';
const MAX_LLM_NOTE_LENGTH = 400;

export type NoteSource = 'sarvam' | 'gemini' | 'code';

export interface WrittenNote {
  readonly note: string;
  readonly source: NoteSource;
  /** The owner's WhatsApp summary lines (prompt v2); null when written in code. */
  readonly said: SaidSummary | null;
}

/** Up to 3 summary lines are kept (2–3 asked for), each cut to a short line. */
export const MAX_SUMMARY_LINES = 3;
const MAX_SUMMARY_LINE_LENGTH = 160;

const SummaryLines = z.array(z.string()).optional().catch(undefined);

const NoteSchema = z.object({
  note: z.string().trim().min(1).max(MAX_LLM_NOTE_LENGTH),
  summary_en: SummaryLines,
  summary: SummaryLines,
});

export function parseNote(content: string): string | null {
  return cleanNote(extractJson(content, NoteSchema)?.note ?? null);
}

function shortLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .slice(0, MAX_SUMMARY_LINES)
    .map((line) =>
      line.length > MAX_SUMMARY_LINE_LENGTH
        ? `${line.slice(0, MAX_SUMMARY_LINE_LENGTH - 1)}…`
        : line
    );
}

/** The summary lines in English and in the owner's language. Owner lines not written in that
 * language's own script are dropped (the English twin still shows the English ones). */
export function parseSaid(content: string, language: Language): SaidSummary | null {
  const answer = extractJson(content, NoteSchema);
  const en = shortLines(answer?.summary_en);
  if (en.length === 0) return null;
  if (language === 'en') return { en, owner: en };
  const owner = shortLines(answer?.summary).filter((line) =>
    inOwnerScript(line, language) !== null
  );
  return { en, owner };
}

interface ParsedNote {
  readonly note: string;
  readonly said: SaidSummary | null;
}

function recordedParts(facts: CallFacts): string[] {
  const { promise, claim, callbacks } = facts;
  return [
    promise
      ? `Promised ${formatInr(promise.amount)} by ${formatShortDay(promise.promiseDate)}.`
      : null,
    claim
      ? `Said ${formatInr(claim.amount)} was paid on ${formatShortDay(claim.paidDate)} ` +
        `(${claim.mode}), not yet confirmed.`
      : null,
    ...callbacks.map((callback) => `Asked the owner to call: ${callback.summary}`),
  ].filter((part): part is string => part !== null);
}

/** A plain note from the call's own records (no LLM). */
export function codeNote(facts: CallFacts): string {
  const day = formatShortDay(facts.today);
  const byOutcome = {
    declined: `Declined the call on ${day}.`,
    no_answer: `Did not answer the call on ${day}.`,
    wrong_person: `Someone else answered on ${day}; nothing was shared.`,
    ended_early: `The call on ${day} ended before identity was confirmed.`,
  } as const;
  const outcome = outcomeOf(facts);
  if (outcome in byOutcome) return byOutcome[outcome as keyof typeof byOutcome];
  const parts = recordedParts(facts);
  const recorded = parts.length > 0 ? parts.join(' ') : `Spoke on ${day}; nothing was agreed.`;
  return toNoteLine(facts.transcriptMissing ? `${recorded} (No transcript.)` : recorded);
}

export async function writeNote(
  llm: JsonLlm,
  facts: CallFacts,
  language: Language = 'en',
): Promise<WrittenNote> {
  const fallback: WrittenNote = { note: codeNote(facts), source: 'code', said: null };
  if (facts.transcript === null || !facts.connected) return fallback;
  const answer = await llm({
    event: NOTE_EVENT,
    system: NOTE_PROMPT,
    message: describeCallForLlm(facts, language),
    parse: function parseAnswer(content): ParsedNote | null {
      const note = parseNote(content);
      return note === null ? null : { note, said: parseSaid(content, language) };
    },
  });
  if (answer.path === 'failed') return fallback;
  return { note: answer.value.note, source: answer.path, said: answer.value.said };
}
