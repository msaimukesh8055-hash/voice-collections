// supabase/functions/_shared/whatsapp/spoken-summary.ts
// The voice reply's words (M7 A1, Decision 2): sarvam-105b writes a short spoken-style summary of
// the reply; code checks every figure and name (spoken-check.ts). Sarvam only: an error, a
// timeout (8 s), bad JSON or any failed check → today's spokenText, which is always correct.
// Logged as `spoken_summary` with the outcome, reason, time and prompt version, never the text.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import { askSarvamChat, extractJson } from '../llm/json-llm.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { Reply } from './replies.ts';
import { sourceText, spokenSource, spokenText } from './spoken.ts';
import { checkSpoken, type SpokenCheckReason } from './spoken-check.ts';
import {
  buildSpokenMessage,
  buildSpokenPrompt,
  pickOpening,
  SPOKEN_PROMPT_VERSION,
} from './spoken-prompt.ts';

/** Variety in wording; the checks keep it safe (Decision 2). */
export const SPOKEN_TEMPERATURE = 0.7;
export const SPOKEN_MAX_TOKENS = 400;

const SpokenAnswerSchema = z.object({ say: z.string() });

export interface SpokenInput {
  readonly replies: readonly Reply[];
  readonly language: Language;
  /** Shopkeeper names, shop names and the owner's name (check 6). */
  readonly names: readonly string[];
}

export type SpokenSummarizer = (input: SpokenInput) => Promise<string>;

export interface SpokenSummarizerConfig {
  readonly sarvamApiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
  /** [0, 1), picks the opening; Math.random in production. */
  readonly random: () => number;
}

type Outcome = { readonly say: string } | { readonly reason: SpokenCheckReason | 'llm_failed' };

async function askSummary(config: SpokenSummarizerConfig, input: SpokenInput): Promise<Outcome> {
  const source = spokenSource(input.replies, input.language);
  const system = buildSpokenPrompt({
    language: input.language,
    opening: pickOpening(config.random),
  });
  const message = buildSpokenMessage({ language: input.language, source });
  let content: string;
  try {
    content = await askSarvamChat(config, {
      system,
      messages: [{ role: 'user', content: message }],
      maxTokens: SPOKEN_MAX_TOKENS,
      temperature: SPOKEN_TEMPERATURE,
    });
  } catch {
    return { reason: 'llm_failed' }; // HTTP error, timeout or odd body: the flat voice is safe.
  }
  const answer = extractJson(content, SpokenAnswerSchema);
  if (!answer) return { reason: 'bad_json' };
  const checked = checkSpoken(answer.say, { ...input, source: sourceText(source) });
  return checked.ok ? { say: answer.say.trim() } : { reason: checked.reason };
}

export function createSpokenSummarizer(config: SpokenSummarizerConfig): SpokenSummarizer {
  return async function summarize(input: SpokenInput): Promise<string> {
    const flat = spokenText(input.replies, input.language);
    if (flat === '') return '';
    const started = Date.now();
    const outcome = await askSummary(config, input);
    const spoken = 'say' in outcome;
    config.log(spoken ? 'info' : 'warn', 'spoken_summary', {
      outcome: spoken ? 'ok' : 'fallback',
      reason: spoken ? null : outcome.reason,
      ms: Date.now() - started,
      prompt: SPOKEN_PROMPT_VERSION,
    });
    return spoken ? outcome.say : flat;
  };
}
