// supabase/functions/_shared/followup/summary.ts
// The owner's WhatsApp summary after every call (SPEC §8.5, M5 Decision 4; reshaped by dry-run
// fix 7, 2026-11-04), in the owner's language:
//   📞 Asha called Ramesh (Ramesh Kirana)       [🧪 Simulated call]
//   Result: <one line>   Summary: 2–3 short lines on what was said
//   Next: <one action>   Score: 54 (Watch)   🔗 Transcript: <link to that call's page>
// The tone level is not on WhatsApp any more (the dashboard shows it). The summary lines and the
// agent's reason come from the LLM already in the owner's language; the English twin is the same
// template rendered with the LLM's English lines (fix 4), never a translation. When Asha recorded
// a payment claim, the summary carries M4's [Confirm received] [Not received] buttons (button ids
// hold only the claimed entry's id). When the next step is "try again", it carries one [Try
// again] button: the same Remind tap as the due alert, so the pre-call checks apply again.
import { claimButtonId, remindButtonId } from '../cards/ids.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { Score } from '../ledger/score.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Button, type Reply, withEnglish } from '../whatsapp/replies.ts';
import type { CallFacts } from './facts.ts';
import { type NextStep, outcomeOf } from './rules.ts';
import { type SummaryPhrases, summaryPhrasesFor } from './summary-phrases.ts';

/** What was said on the call, written by the LLM: English, and the owner's language. */
export interface SaidSummary {
  readonly en: readonly string[];
  /** The owner's language; the same as `en` for an English-speaking owner. */
  readonly owner: readonly string[];
}

export interface SummaryInput {
  readonly facts: CallFacts;
  readonly step: NextStep;
  readonly score: Score | null;
  readonly language: Language;
  /** Null when there is no transcript or the LLM did not answer: the Summary line is left out. */
  readonly said: SaidSummary | null;
  /** The signed link to this call's dashboard page (fix 8), or null when none is set up. */
  readonly transcriptLink: string | null;
}

/** The reason a next step shows, in the language being rendered (English: always the English
 * one; Hindi/Telugu: only the agent's own sentence in that language, never English). */
function reasonIn(step: NextStep, language: Language): string | null {
  if (!('reason' in step)) return null;
  if (language === 'en') return step.reason;
  return 'ownerReason' in step && step.ownerReason ? step.ownerReason : null;
}

function stepText(phrases: SummaryPhrases, input: SummaryInput, language: Language): string {
  const { step, facts } = input;
  const day = 'date' in step ? formatShortDay(step.date) : '';
  return phrases.steps[step.kind]({
    name: facts.shopkeeperName,
    day,
    reason: reasonIn(step, language),
  });
}

function resultText(phrases: SummaryPhrases, facts: CallFacts): string {
  const outcome = outcomeOf(facts);
  if (outcome === 'claim' && facts.claim) {
    const { claim } = facts;
    return phrases.claim(
      formatInr(claim.amount),
      formatShortDay(claim.paidDate),
      phrases.modes[claim.mode],
    );
  }
  if (outcome === 'promise' && facts.promise) {
    return phrases.promise(
      formatInr(facts.promise.amount),
      formatShortDay(facts.promise.promiseDate),
    );
  }
  return phrases.outcomes[outcome];
}

function present(lines: ReadonlyArray<string | null>): string[] {
  return lines.filter((line): line is string => line !== null);
}

function saidLines(input: SummaryInput, language: Language, phrases: SummaryPhrases): string[] {
  const lines = language === 'en' ? input.said?.en : input.said?.owner;
  if (!lines || lines.length === 0) return [];
  return [`${phrases.summary}:`, ...lines.map((line) => `• ${line}`)];
}

/** Three blocks (M6 spacing): who; what happened; what next. */
function summaryText(input: SummaryInput, language: Language): string {
  const phrases = summaryPhrasesFor(language);
  const { facts, score } = input;
  return blocks(
    present([
      phrases.title(facts.shopkeeperName, facts.shopName),
      facts.mode === 'simulated' ? phrases.simulated : null,
    ]),
    [`${phrases.result}: ${resultText(phrases, facts)}`, ...saidLines(input, language, phrases)],
    present([
      `${phrases.next}: ${stepText(phrases, input, language)}`,
      score ? phrases.score(score.score, phrases.bands[score.band]) : null,
      input.transcriptLink ? `🔗 ${phrases.transcript}: ${input.transcriptLink}` : null,
      facts.transcriptMissing ? phrases.noTranscript : null,
    ]),
  );
}

function summaryButtons(input: SummaryInput): readonly Button[] {
  const { claim, shopkeeperId } = input.facts;
  const phrases = phrasesFor(input.language);
  if (claim) {
    return [
      { id: claimButtonId(claim.entryId, true, input.language), title: phrases.confirmReceived },
      { id: claimButtonId(claim.entryId, false, input.language), title: phrases.notReceived },
    ];
  }
  if (input.step.kind !== 'try_again') return [];
  return [{ id: remindButtonId(shopkeeperId, input.language), title: phrases.tryAgain }];
}

export function buildSummary(input: SummaryInput): Reply {
  const buttons = summaryButtons(input);
  return withEnglish(input.language, function render(language): Reply {
    const text = summaryText(input, language);
    return buttons.length > 0 ? { kind: 'buttons', text, buttons } : { kind: 'text', text };
  });
}
