// supabase/functions/_shared/followup/agent.ts
// The follow-up agent (M5 Decision 4, ADR-0006): called only when the rules see mixed signals.
// Sarvam sarvam-105b (Gemini on failure) picks one of three next steps and gives a one-line
// reason, as one JSON object checked here. If neither answer passes, the safe default is
// "the owner should call": a person decides when the machine cannot.
import { z } from 'zod';
import { addDays } from '../clock.ts';
import { DEVANAGARI_SCRIPT, TELUGU_SCRIPT } from '../brain/language.ts';
import { extractJson, type JsonLlm } from '../llm/json-llm.ts';
import type { Language } from '../schemas/shopkeeper.ts';
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

/** v2: the reason again in the owner's language; optional, so a v1-style answer still works. */
const OwnerReason = z.string().optional().catch(undefined);

const AgentAnswerSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('remind_again'),
    remind_on: z.iso.date(),
    reason: Reason,
    owner_reason: OwnerReason,
  }),
  z.object({ decision: z.literal('owner_should_call'), reason: Reason, owner_reason: OwnerReason }),
  z.object({ decision: z.literal('pause_reminders'), reason: Reason, owner_reason: OwnerReason }),
]);

/** The script each owner language must be written in: an English sentence pasted into a
 * Telugu summary is exactly what dry-run fix 7 removes. */
const OWNER_SCRIPT: Readonly<Record<Exclude<Language, 'en'>, RegExp>> = {
  te: TELUGU_SCRIPT,
  hi: DEVANAGARI_SCRIPT,
};

/** Text in the owner's language and script, cleaned and capped; null otherwise (or for English,
 * which needs no second copy). */
export function inOwnerScript(text: string | undefined, language: Language): string | null {
  if (language === 'en' || text === undefined) return null;
  const clean = Reason.safeParse(text);
  return clean.success && OWNER_SCRIPT[language].test(clean.data) ? clean.data : null;
}

/** Text → next step, or null when it is not one of the allowed answers. */
export function parseAgentDecision(
  content: string,
  today: string,
  language: Language = 'en',
): NextStep | null {
  const answer = extractJson(content, AgentAnswerSchema);
  if (answer === null) return null;
  const ownerReason = inOwnerScript(answer.owner_reason, language);
  const local = ownerReason === null ? {} : { ownerReason };
  if (answer.decision !== 'remind_again') {
    return { kind: answer.decision, reason: answer.reason, ...local };
  }
  const inRange = answer.remind_on > today && answer.remind_on <= addDays(today, MAX_REMIND_DAYS);
  if (!inRange) return null;
  return { kind: 'remind_again', date: answer.remind_on, reason: answer.reason, ...local };
}

export async function runFollowupAgent(
  llm: JsonLlm,
  facts: CallFacts,
  language: Language = 'en',
): Promise<AgentResult> {
  const answer = await llm({
    event: AGENT_EVENT,
    system: FOLLOWUP_AGENT_PROMPT,
    message: describeCallForLlm(facts, language),
    parse: (content) => parseAgentDecision(content, facts.today, language),
  });
  if (answer.path === 'failed') {
    return {
      step: { kind: 'owner_should_call', reason: DEFAULT_AGENT_REASON },
      llmPath: 'default',
    };
  }
  return { step: answer.value, llmPath: answer.path };
}
