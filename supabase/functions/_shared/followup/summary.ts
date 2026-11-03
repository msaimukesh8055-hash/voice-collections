// supabase/functions/_shared/followup/summary.ts
// The owner's WhatsApp summary after every call (SPEC §8.5, M5 Decision 4): who, outcome,
// promise or claim, tone level, next step, score, a "simulated" label, and "transcript not
// available" when the summary had to be built from tool events alone. When Asha recorded a
// payment claim, the summary carries M4's [Confirm received] [Not received] buttons (button ids
// hold only the claimed entry's id).
import { claimButtonId } from '../cards/ids.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { Score } from '../ledger/score.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, textReply } from '../whatsapp/replies.ts';
import type { CallFacts, ClaimRecord } from './facts.ts';
import { type NextStep, outcomeOf } from './rules.ts';
import { type SummaryPhrases, summaryPhrasesFor } from './summary-phrases.ts';

export interface SummaryInput {
  readonly facts: CallFacts;
  readonly step: NextStep;
  readonly score: Score | null;
  readonly language: Language;
}

type StepRenderer = (step: NextStep, names: { name: string; day: string }) => string;

function stepText(phrases: SummaryPhrases, step: NextStep, name: string): string {
  // Each entry only ever receives its own kind of step (the lookup is by step.kind).
  const render = phrases.steps[step.kind] as StepRenderer;
  const day = 'date' in step ? formatShortDay(step.date) : '';
  return render(step, { name, day });
}

function claimLine(phrases: SummaryPhrases, claim: ClaimRecord): string {
  return phrases.claim(
    formatInr(claim.amount),
    formatShortDay(claim.paidDate),
    phrases.modes[claim.mode],
  );
}

function summaryLines(input: SummaryInput, phrases: SummaryPhrases): string[] {
  const { facts, step, score } = input;
  const spoke = facts.connected && facts.identity === 'confirmed';
  return [
    phrases.title(facts.shopkeeperName, facts.shopName),
    facts.mode === 'simulated' ? phrases.simulated : null,
    phrases.outcomes[outcomeOf(facts)],
    facts.promise
      ? phrases.promise(formatInr(facts.promise.amount), formatShortDay(facts.promise.promiseDate))
      : null,
    facts.claim ? claimLine(phrases, facts.claim) : null,
    spoke ? phrases.tone(facts.toneLevel, phrases.toneNames[facts.toneLevel]) : null,
    `${phrases.next}: ${stepText(phrases, step, facts.shopkeeperName)}`,
    score ? phrases.score(score.score, phrases.bands[score.band]) : null,
    facts.transcriptMissing ? phrases.noTranscript : null,
  ].filter((line): line is string => line !== null);
}

export function buildSummary(input: SummaryInput): Reply {
  const phrases = summaryPhrasesFor(input.language);
  const text = summaryLines(input, phrases).join('\n');
  const { claim } = input.facts;
  if (!claim) return textReply(text);
  const buttons = phrasesFor(input.language);
  return {
    kind: 'buttons',
    text,
    buttons: [
      { id: claimButtonId(claim.entryId, true, input.language), title: buttons.confirmReceived },
      { id: claimButtonId(claim.entryId, false, input.language), title: buttons.notReceived },
    ],
  };
}
