// supabase/functions/_shared/followup/decide.ts
// Rules first, the agent only for mixed signals (M5 Decision 4), and what the decision leaves
// behind: a followup_runs row (path, decision, reasoning — audited at CP2 and M7) and, when
// someone has to act later, a followups row.
import type { FollowupKind, NewFollowup, NewFollowupRun } from '../db/followup-repository.ts';
import type { JsonLlm } from '../llm/json-llm.ts';
import { type AgentPath, runFollowupAgent } from './agent.ts';
import type { CallFacts } from './facts.ts';
import type { NoteSource } from './note.ts';
import { decideByRules, type MixedSignal, type NextStep, outcomeOf } from './rules.ts';
import type { TranscriptStep } from './transcript-step.ts';

/** Follow-ups due on a date are shown at 9:00 IST that day (the daily alert time, 5b). */
const DAILY_CHECK_TIME = 'T09:00:00+05:30';

export interface FollowupDecision {
  readonly path: 'rule' | 'agent';
  readonly step: NextStep;
  readonly signals: readonly MixedSignal[];
  readonly agentPath: AgentPath | null;
}

const RULE_REASONS: Readonly<Record<NextStep['kind'], string>> = {
  check_promise: 'Promise logged: check it on the promise date.',
  confirm_claim: 'Payment claim recorded: the owner confirms whether it arrived.',
  owner_callback: 'The shopkeeper asked the owner to call back.',
  try_again: 'No conversation took place: try again later.',
  nothing_shared: 'Someone else answered: nothing was shared.',
  remind_again: 'Agent decision.',
  owner_should_call: 'Agent decision.',
  pause_reminders: 'Agent decision.',
};

export async function decideFollowup(facts: CallFacts, llm: JsonLlm): Promise<FollowupDecision> {
  const rules = decideByRules(facts);
  if (rules.kind === 'rule') {
    return { path: 'rule', step: rules.step, signals: [], agentPath: null };
  }
  const agent = await runFollowupAgent(llm, facts);
  return { path: 'agent', step: agent.step, signals: rules.signals, agentPath: agent.llmPath };
}

function reasoningOf(decision: FollowupDecision): string {
  const { step } = decision;
  if (decision.path === 'agent' && 'reason' in step) return step.reason;
  return RULE_REASONS[step.kind];
}

export interface RunContext {
  readonly facts: CallFacts;
  readonly decision: FollowupDecision;
  readonly noteSource: NoteSource;
  readonly transcript: TranscriptStep['kind'];
}

export function runRecord(context: RunContext): NewFollowupRun {
  const { facts, decision } = context;
  return {
    callId: facts.callId,
    shopkeeperId: facts.shopkeeperId,
    path: decision.path,
    decision: decision.step.kind,
    reasoning: reasoningOf(decision),
    actions: {
      outcome: outcomeOf(facts),
      signals: decision.signals,
      agent_path: decision.agentPath,
      note_source: context.noteSource,
      transcript: context.transcript,
      simulated: facts.mode === 'simulated',
    },
  };
}

function scheduled(date: string): string {
  return `${date}${DAILY_CHECK_TIME}`;
}

type RowSpec = { readonly kind: FollowupKind; readonly scheduledFor: string | null } | null;

/** The row an owner or a later run acts on. Asha's callback tool already wrote its own row, and
 * "someone else answered" needs nothing. */
function rowSpec(step: NextStep): RowSpec {
  const specs: {
    readonly [K in NextStep['kind']]: (s: Extract<NextStep, { kind: K }>) => RowSpec;
  } = {
    check_promise: (s) => ({ kind: 'promise_check', scheduledFor: scheduled(s.date) }),
    confirm_claim: () => ({ kind: 'claim_confirm', scheduledFor: null }),
    owner_callback: () => null,
    try_again: () => ({ kind: 'remind_again', scheduledFor: null }),
    nothing_shared: () => null,
    remind_again: (s) => ({ kind: 'remind_again', scheduledFor: scheduled(s.date) }),
    owner_should_call: () => ({ kind: 'owner_callback', scheduledFor: null }),
    pause_reminders: () => ({ kind: 'pause_reminders', scheduledFor: null }),
  };
  return (specs[step.kind] as (s: NextStep) => RowSpec)(step);
}

export function followupRowFor(context: RunContext): NewFollowup | null {
  const spec = rowSpec(context.decision.step);
  if (spec === null) return null;
  const { facts } = context;
  return {
    callId: facts.callId,
    shopkeeperId: facts.shopkeeperId,
    kind: spec.kind,
    reason: reasoningOf(context.decision),
    scheduledFor: spec.scheduledFor,
  };
}
