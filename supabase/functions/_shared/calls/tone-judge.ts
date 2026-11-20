// supabase/functions/_shared/calls/tone-judge.ts
// Live evals (Saim, 2026-11-20): the AI judge for what code cannot judge, how the agent sounded.
// Gemini (not Sarvam, so the agent's own model never marks its own work) reads the spoken
// words of one finished call and scores each point 1–5 with a one-line reason. It runs once per
// call, the first time the report opens, and is saved on the call, so opening it again costs
// nothing. A judge can be wrong, so a low score only warns; it never fails a call on its own.
// ⚠️ Judge prompt v1 is a draft: the prompt text is Saim's decision.
import { z } from 'zod';
import { askGeminiChat, extractJson, GEMINI_MODEL, type JsonLlmConfig } from '../llm/json-llm.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { describeFailure } from '../tools/registry.ts';
import { type Check, check, type Scorecard, summarise } from './scorecard.ts';
import { toolUseChecks } from './scorecard-missed.ts';

export const TONE_PROMPT_VERSION = 'v1';
/** A score this high or higher passes; lower warns. */
export const TONE_PASS_SCORE = 4;
const MAX_JUDGE_TOKENS = 800;
const MAX_REASON_CHARS = 160;

export type ToneAgent = 'asha' | 'munshi';

interface Point {
  readonly id: string;
  readonly label: string;
  /** What the judge is told this point means. */
  readonly ask: string;
}

const POINTS: Readonly<Record<ToneAgent, readonly Point[]>> = {
  asha: [
    {
      id: 'respectful',
      label: 'Polite and respectful',
      ask: 'polite and respectful all through, even when the shopkeeper is short or upset',
    },
    {
      id: 'no_pressure',
      label: 'No pressure, threats or shaming',
      ask: 'never threatens, shames, rushes or pressures; firm is fine, harsh is not',
    },
    {
      id: 'listened',
      label: 'Listened and answered what was said',
      ask:
        'responds to what the shopkeeper actually said, including any hardship, instead of a script',
    },
    {
      id: 'clear',
      label: 'Clear on a phone call',
      ask: 'easy to follow by ear: one thing at a time, figures and dates said plainly',
    },
  ],
  munshi: [
    {
      id: 'friendly',
      label: 'Friendly, like the shop next door',
      ask:
        'warm, everyday words, like a helper at the shop counter; no speeches, no "how may I help you"',
    },
    {
      id: 'language_match',
      label: 'Spoke his language',
      ask:
        'answers in the language the owner speaks (English words like credit or pending mixed in are fine)',
    },
    {
      id: 'clear',
      label: 'Clear on a phone call',
      ask: 'easy to follow by ear: answers first, one thing at a time, figures said plainly',
    },
    {
      id: 'on_point',
      label: 'Answered what was asked',
      ask: 'stays on what the owner asked, and says plainly when the book cannot do something',
    },
  ],
};

const SPEAKERS: Readonly<Record<ToneAgent, readonly [agent: string, other: string]>> = {
  asha: ['ASHA', 'SHOPKEEPER'],
  munshi: ['MUNSHI', 'OWNER'],
};

const ROLES: Readonly<Record<ToneAgent, string>> = {
  asha:
    "Asha is a voice agent who calls small shopkeepers in Anantapur to remind them, politely, about credit they owe to Srinivas's wholesale shop.",
  munshi:
    'Munshi keeps the credit book of Srinivas, a wholesale trader in Anantapur, and talks to him on a call.',
};

const PointSchema = z.object({
  id: z.string(),
  score: z.number().int().min(1).max(5),
  reason: z.string().catch('').transform((text) => text.slice(0, MAX_REASON_CHARS)),
});
const AnswerSchema = z.object({ points: z.array(PointSchema).min(1) });

export const ToneJudgementSchema = z.object({
  version: z.string(),
  model: z.string(),
  points: z.array(PointSchema),
});
export type ToneJudgement = z.infer<typeof ToneJudgementSchema>;

/** The judge, or null when there is no Gemini key. */
export type ToneJudge = (agent: ToneAgent, turns: readonly Turn[]) => Promise<ToneJudgement | null>;

export function buildTonePrompt(agent: ToneAgent): string {
  const [name] = SPEAKERS[agent];
  const points = POINTS[agent].map((point) => `- ${point.id}: ${point.ask}`).join('\n');
  const ids = POINTS[agent].map((point) => `"${point.id}"`).join(', ');
  return `You review the transcript of a real phone call made by a voice assistant. All people and amounts are fictional test data.
${ROLES[agent]}
Judge ${name}'s lines across the WHOLE call (not line by line). Give each of these points one score from 1 (bad) to 5 (excellent):
${points}
Ignore whether figures are right and which tools were used; code checks those. Lines may be cut short where someone was interrupted.
Reply with ONE JSON object holding exactly ${POINTS[agent].length} points, with the ids ${ids}:
{"points": [{"id": "<one of the ids>", "score": 1-5, "reason": "<one short sentence; quote the worst line if the score is below 4>"}]}`;
}

/** Spoken words only, one line per turn: "MUNSHI: …" / "OWNER: …". */
export function toneMessage(agent: ToneAgent, turns: readonly Turn[]): string {
  const [name, other] = SPEAKERS[agent];
  return turns.map((turn) => `${turn.role === 'assistant' ? name : other}: ${turn.content}`)
    .join('\n');
}

export function createToneJudge(config: JsonLlmConfig): ToneJudge {
  return async function judgeTone(agent, turns): Promise<ToneJudgement | null> {
    if (turns.length === 0) return null;
    try {
      const raw = await askGeminiChat(config, {
        system: buildTonePrompt(agent),
        messages: [{ role: 'user', content: toneMessage(agent, turns) }],
        maxTokens: MAX_JUDGE_TOKENS,
      });
      const answer = extractJson(raw, AnswerSchema);
      config.log('info', 'tone_judge', { agent, outcome: answer ? 'judged' : 'bad_json' });
      return answer ? { version: TONE_PROMPT_VERSION, model: GEMINI_MODEL, ...answer } : null;
    } catch (error) {
      config.log('warn', 'tone_judge', { agent, outcome: describeFailure(error) });
      return null;
    }
  };
}

function toneChecks(agent: ToneAgent, judgement: ToneJudgement | null): Check[] {
  return POINTS[agent].map((point) => {
    const found = judgement?.points.find((one) => one.id === point.id);
    if (!found) return check(`tone_${point.id}`, point.label, ['na', 'not judged']);
    const value = `${found.score}/5${found.reason ? ` · ${found.reason}` : ''}`;
    return check(`tone_${point.id}`, point.label, [
      found.score >= TONE_PASS_SCORE ? 'pass' : 'warn',
      value,
    ]);
  });
}

/** The scorecard with a "Tone (AI judge)" group added and the totals worked out again. */
export function withTone(
  card: Scorecard,
  agent: ToneAgent,
  judgement: ToneJudgement | null,
): Scorecard {
  const groups = [...card.groups, { name: 'Tone' as const, checks: toneChecks(agent, judgement) }];
  return { ...card, ...summarise(groups, toolUseChecks(card.toolUse)), groups };
}
