// supabase/functions/_shared/db/owner-call-reads.ts
// Live evals for Munshi (2026-11-20): what the Munshi call report reads. Calls the owner actually
// started (accepted, in progress or completed), newest first, and one call with its transcript and
// Munshi's tool calls. The transcript is fetched from Sarvam once and kept here. Service role.
import type { ToneJudgement } from '../calls/tone-judge.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { DashboardToolEvent } from './dashboard-repository.ts';
import type { OwnerCallStatus } from './owner-call-repository.ts';

export interface OwnerCallRow {
  readonly id: string;
  readonly status: OwnerCallStatus;
  readonly issuedAt: string;
  readonly acceptedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  /** Opened by a test script, not the owner: tagged on Munshi calls, left out of Agent health. */
  readonly isTest: boolean;
}

export interface OwnerCallDetail extends OwnerCallRow {
  readonly interactionId: string | null;
  readonly transcript: readonly Turn[] | null;
  readonly transcriptEnglish: readonly (string | null)[] | null;
  /** The AI tone judge's scores, made once and kept; null until made. */
  readonly toneJudgement: ToneJudgement | null;
  readonly toolEvents: readonly DashboardToolEvent[];
}

export interface OwnerCallReads {
  listOwnerCalls(ownerId: string, limit: number): Promise<readonly OwnerCallRow[]>;
  getOwnerCallDetail(ownerCallId: string): Promise<OwnerCallDetail | null>;
  saveOwnerCallTranscript(ownerCallId: string, turns: readonly Turn[]): Promise<void>;
  saveOwnerCallEnglish(ownerCallId: string, lines: readonly (string | null)[]): Promise<void>;
  saveOwnerCallTone(ownerCallId: string, judgement: ToneJudgement): Promise<void>;
}
