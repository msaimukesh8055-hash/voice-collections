// evals/munshi/judge.ts
// The LLM judge of Munshi's text evals (M8 C1): Gemini reads the transcript (spoken words only,
// never tool replies) and scores Munshi 1–5 on the casual "friend next door" tone, matching the
// owner's language, and clarity. The answer is checked with Zod; a failed or unusable answer
// gives no score (null), which the summary reports as "not judged". Code checks decide safety;
// the judge only scores how he sounds.
// ⚠️ Judge prompt v1 is a draft (prompt text is Saim's decision).
import { z } from 'zod';
import { extractJson } from '../../supabase/functions/_shared/llm/json-llm.ts';
import type { Logger } from '../../supabase/functions/_shared/log.ts';
import type { Turn } from '../../supabase/functions/_shared/sarvam-analytics.ts';
import {
  SARVAM_LANGUAGE_NAMES,
  type Language,
} from '../../supabase/functions/_shared/schemas/shopkeeper.ts';
import type { ChatProvider } from '../../supabase/functions/_shared/simulator/run.ts';
import { describeFailure } from '../../supabase/functions/_shared/tools/registry.ts';

export const JUDGE_PROMPT_VERSION = 'v1';
const MAX_JUDGE_TOKENS = 200;
const MAX_NOTE_CHARS = 300;

const Score = z.number().int().min(1).max(5);
export const JudgeScoresSchema = z.object({
  casual: Score,
  language_match: Score,
  clarity: Score,
  note: z
    .string()
    .catch('')
    .transform((note) => note.slice(0, MAX_NOTE_CHARS)),
});
export type JudgeScores = z.infer<typeof JudgeScoresSchema>;

export function buildJudgePrompt(language: Language): string {
  return `You review a TEXT simulation of a phone call, used to test a voice assistant. Everything is fictional.
Munshi keeps the credit book of Srinivas, a wholesale trader in Anantapur, and talks to him on a call. Srinivas mostly speaks ${SARVAM_LANGUAGE_NAMES[language]}.
Score only Munshi's lines, each from 1 (bad) to 5 (excellent):
- casual: sounds like a friendly guy from next door at the shop counter: short, warm, everyday words; no speeches, no formal words, no "sir", no "how may I help you".
- language_match: answers in the language Srinivas speaks (code-mixed English words like credit, balance and pending are fine).
- clarity: easy to follow when heard on a phone: answers first, one thing at a time, figures said clearly.
Ignore whether the figures are right; that is checked elsewhere.
Reply with ONE JSON object: {"casual": 1-5, "language_match": 1-5, "clarity": 1-5, "note": "<the biggest problem in one short sentence, or empty>"}`;
}

/** Spoken words only, one line per turn: "MUNSHI: …" / "OWNER: …". */
export function judgeMessage(transcript: readonly Turn[]): string {
  return transcript
    .map((turn) => `${turn.role === 'assistant' ? 'MUNSHI' : 'OWNER'}: ${turn.content}`)
    .join('\n');
}

export interface JudgeInput {
  readonly language: Language;
  readonly transcript: readonly Turn[];
}

export async function judgeConversation(
  judge: ChatProvider,
  input: JudgeInput,
  log: Logger,
): Promise<JudgeScores | null> {
  try {
    const raw = await judge.ask({
      system: buildJudgePrompt(input.language),
      messages: [{ role: 'user', content: judgeMessage(input.transcript) }],
      maxTokens: MAX_JUDGE_TOKENS,
    });
    const scores = extractJson(raw, JudgeScoresSchema);
    if (!scores) log('warn', 'munshi_eval_judge', { provider: judge.name, outcome: 'bad_json' });
    return scores;
  } catch (error) {
    log('warn', 'munshi_eval_judge', { provider: judge.name, outcome: describeFailure(error) });
    return null;
  }
}
