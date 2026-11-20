// supabase/functions/calls-api/types.ts
// Shared shapes for the app API's routes.
import type { BookRepository, Owner } from '../_shared/db/book-repository.ts';
import type { DashboardRepository } from '../_shared/db/dashboard-repository.ts';
import type { EvalReads } from '../_shared/db/eval-reads.ts';
import type { OpsRepository } from '../_shared/db/ops-repository.ts';
import type { OwnerCallReads } from '../_shared/db/owner-call-reads.ts';
import type { FollowupKicker } from '../_shared/followup/kick.ts';
import type { ScoreReads } from '../_shared/reminders/score-explain.ts';
import type { ToneJudge } from '../_shared/calls/tone-judge.ts';
import type { CallScoreRepository } from '../_shared/db/call-score-repository.ts';
import type { TestDraftRepository } from '../_shared/db/test-draft-repository.ts';
import type { TranscriptClient } from '../_shared/sarvam-analytics.ts';
import type { Translator } from '../_shared/speech/translate.ts';
import type { MunshiLine, ProxyDeps } from './sarvam-proxy.ts';

export interface CallsApiDeps extends ProxyDeps {
  /** Dashboard / phone page origins allowed to call the API from a browser. */
  readonly allowedOrigins: readonly string[];
  /** Wakes the follow-up worker for a call that just ended (M5); runs in the background. */
  readonly kickFollowup: FollowupKicker;
  /** What is deployed ("<commit> <time>"), for the health check; null when not stamped. */
  readonly version?: string | null;
  /** The web dashboard's reads (M6), behind the signed link. */
  readonly dashboard: DashboardDeps;
  /** The /munshi page (M8): owner calls, the link secret and the owner's names. */
  readonly munshi: MunshiDeps;
}

export interface MunshiDeps extends MunshiLine {
  readonly getOwner: () => Promise<Owner | null>;
}

export interface DashboardDeps {
  /** Signs and checks dashboard links (DASHBOARD_LINK_SECRET). */
  readonly linkSecret: string;
  /** DASHBOARD_PUBLIC=on: every dashboard route skips the link check (public demo). */
  readonly publicDemo?: boolean;
  readonly book: Pick<
    BookRepository,
    'getOwner' | 'listShopkeepers' | 'listEntries' | 'listShopkeeperEntries'
  >;
  readonly reads: DashboardRepository;
  /** The ops page's reads (M9): the summary and one trace's steps. */
  readonly ops: OpsRepository;
  /** The Evals page's reads (M9): stored eval runs and their case results. */
  readonly evals: EvalReads;
  readonly score: ScoreReads;
  /** Sarvam Translate for the transcript's English (M6); null when no Sarvam key is set. */
  readonly translate: Translator | null;
  /** Live evals for Munshi (2026-11-20): the owner's calls to Munshi, for the call report. */
  readonly ownerCalls: OwnerCallReads;
  /** Munshi's transcripts from Sarvam (Munshi's app id); null when Munshi is not set up. */
  readonly munshiTranscripts: TranscriptClient | null;
  /** The AI tone judge for call reports (Gemini); null when there is no Gemini key. */
  readonly judgeTone?: ToneJudge | null;
  /** Agent health (2026-11-20): each call's kept score and the published prompt versions. */
  readonly callScores: CallScoreRepository;
  /** Live failures to tests (2026-11-20): "Add as a test case" drafts. */
  readonly testDrafts: TestDraftRepository;
}

export interface RouteContext {
  readonly deps: CallsApiDeps;
  readonly cors: HeadersInit;
  /** Path parameters captured by the route pattern, URL-decoded. */
  readonly params: readonly string[];
}

export type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>;
