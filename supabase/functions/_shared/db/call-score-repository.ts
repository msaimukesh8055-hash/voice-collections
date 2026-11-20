// supabase/functions/_shared/db/call-score-repository.ts
// Agent health (2026-11-20): where each call's scorecard result is kept (call_scores) and the
// prompt versions published to Sarvam (publishes). Service role only.
import type { CallScore, HealthAgent, Publish } from '../calls/agent-health.ts';

export interface CallScoreRepository {
  /** Insert or replace one call's score. */
  saveCallScore(score: CallScore): Promise<void>;
  /** One agent's kept scores, newest call first. */
  listCallScores(agent: HealthAgent, limit: number): Promise<readonly CallScore[]>;
  listPublishes(): Promise<readonly Publish[]>;
}
