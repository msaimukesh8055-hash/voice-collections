// supabase/functions/_shared/followup/agent.ts
// The follow-up agent (M5 Decision 4, ADR-0006): called only when the rules see mixed signals.
// Sarvam sarvam-105b (Gemini on failure) picks one of three next steps and gives a one-line
// reason, as one JSON object checked here. If neither answer passes, the safe default is
// "the owner should call": a person decides when the machine cannot.
import { z } from 'zod';
import { addDays } from '../clock.ts';
import { extractJson, type JsonLlm } from '../llm/json-llm.ts';
import type { CallFacts } from './facts.ts';
import { describeCallForLlm, FOLLOWUP_AGENT_PROMPT } from './prompts.ts';
import type { NextStep } from './rules.ts';

export const AGENT_EVENT = 'followup_agent';
export const MAX_REMIND_DAYS = 14;
export const MAX_REASON_LENGTH = 200;
export const DEFAULT_AGENT_REASON = 'The assistant could not decide on a next step.';

export type AgentPath = 'sarvam' | 'gemini' | 'default';

export interface AgentResult {
  readonly step: NextStep;
  readonly llmPath: AgentPath;
}

const Reason = z.string().transform((text) => text.replace(/\s+/g, ' ').trim()).pipe(
  z.string().min(1).max(MAX_REASON_LENGTH),
);

const AgentAnswerSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('remind_again'), remind_on: z.iso.date(), reason: Reason }),
  z.object({ decision: z.literal('owner_should_call'), reason: Reason }),
  z.object({ decision: z.literal('pause_reminders'), reason: Reason }),
]);

/** Text → next step, or null when it is not one of the allowed answers. */
export function parseAgentDecision(content: string, today: string): NextStep | null {
  const answer = extractJson(content, AgentAnswerSchema);
  if (answer === null) return null;
  if (answer.decision !== 'remind_again') return { kind: answer.decision, reason: answer.reason };
  const inRange = answer.remind_on > today && answer.remind_on <= addDays(today, MAX_REMIND_DAYS);
  return inRange ? { kind: 'remind_again', date: answer.remind_on, reason: answer.reason } : null;
}

export async function runFollowupAgent(llm: JsonLlm, facts: CallFacts): Promise<AgentResult> {
  const answer = await llm({
    event: AGENT_EVENT,
    system: FOLLOWUP_AGENT_PROMPT,
    message: describeCallForLlm(facts),
    parse: (content) => parseAgentDecision(content, facts.today),
  });
  if (answer.path === 'failed') {
    return {
      step: { kind: 'owner_should_call', reason: DEFAULT_AGENT_REASON },
      llmPath: 'default',
    };
  }
  return { step: answer.value, llmPath: answer.path };
}
