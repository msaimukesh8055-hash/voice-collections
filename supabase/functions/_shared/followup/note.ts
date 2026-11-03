// supabase/functions/_shared/followup/note.ts
// The note Asha reads on her next call (SPEC §8.4, M5 Decision 4): always written. With a
// transcript, the LLM writes 1–2 lines (NOTE_PROMPT, checked JSON); without one, or if both
// providers fail, the note is built in code from what the call recorded. Either way it is cleaned
// to one short line (memory.ts) before it is stored.
import { z } from 'zod';
import { cleanNote, toNoteLine } from '../calls/memory.ts';
import { formatInr, formatShortDay } from '../format.ts';
import { extractJson, type JsonLlm } from '../llm/json-llm.ts';
import type { CallFacts } from './facts.ts';
import { describeCallForLlm, NOTE_PROMPT } from './prompts.ts';
import { outcomeOf } from './rules.ts';

export const NOTE_EVENT = 'followup_note';
const MAX_LLM_NOTE_LENGTH = 400;

export type NoteSource = 'sarvam' | 'gemini' | 'code';

export interface WrittenNote {
  readonly note: string;
  readonly source: NoteSource;
}

const NoteSchema = z.object({ note: z.string().trim().min(1).max(MAX_LLM_NOTE_LENGTH) });

export function parseNote(content: string): string | null {
  return cleanNote(extractJson(content, NoteSchema)?.note ?? null);
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

export async function writeNote(llm: JsonLlm, facts: CallFacts): Promise<WrittenNote> {
  const fallback: WrittenNote = { note: codeNote(facts), source: 'code' };
  if (facts.transcript === null || !facts.connected) return fallback;
  const answer = await llm({
    event: NOTE_EVENT,
    system: NOTE_PROMPT,
    message: describeCallForLlm(facts),
    parse: parseNote,
  });
  return answer.path === 'failed' ? fallback : { note: answer.value, source: answer.path };
}
