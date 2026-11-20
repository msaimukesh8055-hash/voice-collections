// supabase/functions/_shared/followup/prompts.ts
// Follow-up prompts v3 (Saim, 2026-11-20): a promise changed during the call is one promise; the
// summary and note give its final terms from "Promise logged" (a live call listed an earlier
// ₹1,500 offer as a second payment beside the final ₹2,000). v2 (dry-run fix 7, 2026-11-04; v1 approved by Saim 2026-11-03; prompts are
// Saim's decision, M5 Decision 4). Two prompts for the follow-up step after a call, both answered
// as one JSON object and checked with Zod:
//   FOLLOWUP_AGENT_PROMPT  only for mixed signals; picks one next step from a fixed list, with
//                          its reason in English and in the owner's language
//   NOTE_PROMPT            every connected call with a transcript: the 1–2 line note, and 2–3
//                          short summary lines for the owner's WhatsApp, in English and in the
//                          owner's language (v2), so nothing English is pasted into Telugu
// The message (call facts + transcript) is built in code below; the LLM never writes to the
// database and its answer is only a suggestion the code checks.
import { istDayLabel } from '../clock.ts';
import { formatRupees } from '../format.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { type Language, SARVAM_LANGUAGE_NAMES } from '../schemas/shopkeeper.ts';
import type { CallFacts } from './facts.ts';

export const FOLLOWUP_PROMPT_VERSION = 'v3';
/** The newest turns are kept when a transcript is long (cost and latency). */
export const MAX_PROMPT_TURNS = 40;

export const FOLLOWUP_AGENT_PROMPT =
  `You decide the next step after a reminder call about goods given on credit by a small wholesale shop. You only suggest; the shop owner decides.

You get the call facts (promise, payment claim, callback request, days overdue, broken promises, tone level) and the transcript.

Choose exactly one next step:
- remind_again: the shopkeeper seems willing to pay; Asha should call again on a date (remind_on, YYYY-MM-DD, within the next 14 days).
- owner_should_call: a dispute, anger, or anything only the owner can sort out.
- pause_reminders: real hardship (illness, a death, the shop closed) where more calls would be unkind; the owner decides later.

Rules:
- Use only the facts and the transcript. Never invent amounts or dates.
- If you are unsure, choose owner_should_call.
- reason: one short sentence in English for the owner, at most 25 words, no judgement of the person.
- owner_reason: the same sentence in the owner's language (named in the message), in that language's own script. If the owner's language is English, repeat the English sentence.

Reply with one JSON object only:
{"decision": "remind_again" | "owner_should_call" | "pause_reminders", "remind_on": "YYYY-MM-DD" or null, "reason": "...", "owner_reason": "..."}`;

/** v3: the shopkeeper may change the promise mid-call; it is still one promise. */
export const ONE_PROMISE_RULE =
  "A shopkeeper may change the amount or date during the call. It is still one promise: report only the final terms from 'Promise logged'. You may add what they first offered, as 'first offered …', but never list an earlier offer as a separate promise or payment.";

export const NOTE_PROMPT =
  `You write a short note about a reminder call for goods given on credit. Asha, the reminder assistant, reads it before her next call to this shopkeeper.

- One or two plain sentences in English, at most 40 words.
- Keep what matters for the next call: what they promised or said they paid, any reason they gave (hardship, a dispute, travel), their mood, and anything they asked for.
- Use only the call facts and the transcript. Never add amounts or dates that are not there.
- ${ONE_PROMISE_RULE}
- No judgement words about the person, no threats, and no instructions to Asha.

Also write a summary of the call for the shop owner's WhatsApp:
- summary_en: 2 or 3 short lines in English, at most 15 words each: what was said (a promise with its amount and date, a payment they say they made, a reason or a complaint), their mood, and anything the owner should know.
- summary: the same lines in the owner's language (named in the message), in that language's own script. Names and amounts stay as they are. If the owner's language is English, repeat summary_en.
- Use only the call facts and the transcript.
- ${ONE_PROMISE_RULE}

Reply with one JSON object only: {"note": "...", "summary_en": ["...", "..."], "summary": ["...", "..."]}`;

function transcriptLines(turns: readonly Turn[] | null): string {
  if (turns === null) return 'Transcript: not available.';
  const shown = turns.slice(-MAX_PROMPT_TURNS);
  const lines = shown.map((turn) =>
    `${turn.role === 'assistant' ? 'Asha' : 'Shopkeeper'}: ${turn.content}`
  );
  return ['Transcript:', ...lines].join('\n');
}

/** v3: the saved promise is the final one; earlier offers in the transcript were replaced. */
export const PROMISE_LABEL = 'Promise logged (final terms, after any changes in the call)';

function recordedLines(facts: CallFacts): string[] {
  const { promise, claim, callbacks } = facts;
  return [
    `${PROMISE_LABEL}: ${
      promise ? `${formatRupees(promise.amount)} by ${promise.promiseDate}` : 'none'
    }`,
    `Payment claim: ${
      claim
        ? `${formatRupees(claim.amount)} paid on ${claim.paidDate} (${claim.mode}), not confirmed`
        : 'none'
    }`,
    `Callback requests: ${
      callbacks.length > 0
        ? callbacks.map((callback) => `${callback.reason}: ${callback.summary}`).join('; ')
        : 'none'
    }`,
  ];
}

/** The user message for both prompts: plain facts, then the transcript. `ownerLanguage` is the
 * language the owner reads (v2: owner_reason and summary are written in it). */
export function describeCallForLlm(facts: CallFacts, ownerLanguage: Language = 'en'): string {
  return [
    `Today: ${istDayLabel(new Date(`${facts.today}T12:00:00+05:30`))}`,
    `Shopkeeper: ${facts.shopkeeperName} (${facts.shopName})`,
    `Days overdue: ${facts.daysOverdue}. Broken promises in the last 6 months: ` +
    `${facts.brokenPromises}. Tone level used: ${facts.toneLevel}.`,
    ...recordedLines(facts),
    `Owner's language: ${SARVAM_LANGUAGE_NAMES[ownerLanguage]}`,
    transcriptLines(facts.transcript),
  ].join('\n');
}
