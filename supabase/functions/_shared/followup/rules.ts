// supabase/functions/_shared/followup/rules.ts
// Follow-up rules (M5 Decision 4, ADR-0006): plain code decides the clear cases, and only mixed
// signals (no promise, hardship, an angry call, or a promise *and* a dispute) go to the agent.
//   not answered / declined / ended before identity → try again
//   someone else answered                            → nothing shared
//   claim recorded                                   → owner confirms [Confirm received] / [Not received]
//   promise logged                                   → check on the promise date
//   owner callback asked                             → "please call <name>: <reason>"
import type { CallFacts } from './facts.ts';

export type NextStep =
  | { readonly kind: 'check_promise'; readonly date: string }
  | { readonly kind: 'confirm_claim' }
  | { readonly kind: 'owner_callback'; readonly reason: string }
  | { readonly kind: 'try_again' }
  | { readonly kind: 'nothing_shared' }
  | (
    & { readonly kind: 'remind_again'; readonly date: string; readonly reason: string }
    & AgentReason
  )
  | ({ readonly kind: 'owner_should_call'; readonly reason: string } & AgentReason)
  | ({ readonly kind: 'pause_reminders'; readonly reason: string } & AgentReason);

/** Dry-run fix 7: the agent's reason in the owner's language (Hindi or Telugu), for the
 * WhatsApp summary; `reason` stays English for the audit row and the dashboard. */
export interface AgentReason {
  readonly ownerReason?: string;
}

export type MixedSignal = 'no_promise' | 'hardship' | 'dispute_with_promise' | 'angry';

export type RuleResult =
  | { readonly kind: 'rule'; readonly step: NextStep }
  | { readonly kind: 'agent'; readonly signals: readonly MixedSignal[] };

export type Outcome =
  | 'declined'
  | 'no_answer'
  | 'wrong_person'
  | 'ended_early'
  | 'claim'
  | 'promise'
  | 'callback'
  | 'no_promise';

/** "Stop calling" in English, Latin-letter Hindi, Hindi and Telugu (lower case). A rough signal:
 * it only sends the call to the agent for a second look. ⚠️ Native-speaker check pending. */
export const ANGRY_PHRASES = [
  'stop calling',
  "don't call",
  'dont call',
  'do not call',
  'harass',
  'fed up',
  'call mat karo',
  'phone mat karo',
  'फोन मत',
  'कॉल मत',
  'ఫోన్ చేయకండి',
  'కాల్ చేయకండి',
] as const;

function soundsAngry(facts: CallFacts): boolean {
  const said = (facts.transcript ?? [])
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content.toLowerCase())
    .join('\n');
  return ANGRY_PHRASES.some((phrase) => said.includes(phrase));
}

function hasCallback(facts: CallFacts, reason: string): boolean {
  return facts.callbacks.some((callback) => callback.reason === reason);
}

export function findMixedSignals(facts: CallFacts): readonly MixedSignal[] {
  const nothingAgreed = !facts.promise && !facts.claim && facts.callbacks.length === 0;
  const checks: ReadonlyArray<readonly [MixedSignal, boolean]> = [
    ['no_promise', nothingAgreed],
    ['hardship', hasCallback(facts, 'hardship')],
    ['dispute_with_promise', facts.promise !== null && hasCallback(facts, 'dispute')],
    ['angry', soundsAngry(facts)],
  ];
  return checks.filter(([, found]) => found).map(([signal]) => signal);
}

export function outcomeOf(facts: CallFacts): Outcome {
  if (!facts.connected) return facts.declined ? 'declined' : 'no_answer';
  if (facts.identity === 'denied') return 'wrong_person';
  if (facts.identity !== 'confirmed') {
    return facts.callbacks.length > 0 ? 'callback' : 'ended_early';
  }
  if (facts.claim) return 'claim';
  if (facts.promise) return 'promise';
  return facts.callbacks.length > 0 ? 'callback' : 'no_promise';
}

/** Steps for outcomes that never need the agent. */
function clearStep(facts: CallFacts): NextStep | null {
  const outcome = outcomeOf(facts);
  if (outcome === 'wrong_person') return { kind: 'nothing_shared' };
  if (outcome === 'declined' || outcome === 'no_answer' || outcome === 'ended_early') {
    return { kind: 'try_again' };
  }
  return null;
}

/** After the mixed-signal check, at least one of claim, promise or callback is present. */
function recordedStep(facts: CallFacts): NextStep {
  if (facts.claim) return { kind: 'confirm_claim' };
  if (facts.promise) return { kind: 'check_promise', date: facts.promise.promiseDate };
  return { kind: 'owner_callback', reason: facts.callbacks.map((c) => c.summary).join(' ') };
}

export function decideByRules(facts: CallFacts): RuleResult {
  const clear = clearStep(facts);
  if (clear) return { kind: 'rule', step: clear };
  const signals = facts.identity === 'confirmed' ? findMixedSignals(facts) : [];
  if (signals.length > 0) return { kind: 'agent', signals };
  return { kind: 'rule', step: recordedStep(facts) };
}
