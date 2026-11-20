// supabase/functions/calls-api/tone-route.ts
// Live evals (2026-11-20): the AI tone judge for one call's report, Asha's or Munshi's. Judged
// once, the first time the report opens with a transcript, then saved on the call so it is never
// paid for twice. Best effort: if Gemini or the save fails, the report shows "not judged".
import type { CallScore } from '../_shared/calls/agent-health.ts';
import type { ToneAgent, ToneJudgement } from '../_shared/calls/tone-judge.ts';
import type { Turn } from '../_shared/sarvam-analytics.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import type { RouteContext } from './types.ts';

export interface Judgeable {
  readonly agent: ToneAgent;
  readonly transcript: readonly Turn[] | null;
  readonly toneJudgement: ToneJudgement | null;
  readonly save: (judgement: ToneJudgement) => Promise<void>;
}

export async function toneOf(call: Judgeable, ctx: RouteContext): Promise<ToneJudgement | null> {
  const judge = ctx.deps.dashboard.judgeTone;
  if (call.toneJudgement || !judge || !call.transcript || call.transcript.length === 0) {
    return call.toneJudgement;
  }
  const judgement = await judge(call.agent, call.transcript);
  if (judgement) {
    await call.save(judgement).catch((error: unknown) =>
      ctx.deps.log('warn', 'tone_judgement_not_saved', { error: describeFailure(error) })
    );
  }
  return judgement;
}

/** Tone point id → score, for the kept call score. */
export function toneScores(judgement: ToneJudgement | null): Record<string, number> {
  return Object.fromEntries((judgement?.points ?? []).map((point) => [point.id, point.score]));
}

/** Keep one call's score for the health page; a failed save is logged, never thrown. */
export async function keepScore(score: CallScore, ctx: RouteContext): Promise<void> {
  await ctx.deps.dashboard.callScores.saveCallScore(score).catch((error: unknown) =>
    ctx.deps.log('warn', 'call_score_not_saved', { error: describeFailure(error) })
  );
}
