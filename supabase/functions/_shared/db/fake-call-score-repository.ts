// supabase/functions/_shared/db/fake-call-score-repository.ts
// In-memory CallScoreRepository for tests. FAKE DATA ONLY.
import type { CallScore, Publish } from '../calls/agent-health.ts';
import type { CallScoreRepository } from './call-score-repository.ts';

export interface FakeCallScores {
  readonly scores: CallScore[];
  readonly publishes: Publish[];
}

export function fakeCallScoreRepository(
  start: Partial<FakeCallScores> = {},
): { readonly repo: CallScoreRepository; readonly state: FakeCallScores } {
  const state: FakeCallScores = {
    scores: [...(start.scores ?? [])],
    publishes: [...(start.publishes ?? [])],
  };
  const repo: CallScoreRepository = {
    saveCallScore(score): Promise<void> {
      const at = state.scores.findIndex((one) =>
        one.agent === score.agent && one.callId === score.callId
      );
      if (at === -1) state.scores.push(score);
      else state.scores[at] = score;
      return Promise.resolve();
    },
    listCallScores: (agent, limit) =>
      Promise.resolve(
        state.scores.filter((one) => one.agent === agent)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, limit),
      ),
    listPublishes: () => Promise.resolve(state.publishes),
  };
  return { repo, state };
}
