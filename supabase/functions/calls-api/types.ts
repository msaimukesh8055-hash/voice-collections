// supabase/functions/calls-api/types.ts
// Shared shapes for the app API's routes.
import type { BookRepository, Owner } from '../_shared/db/book-repository.ts';
import type { DashboardRepository } from '../_shared/db/dashboard-repository.ts';
import type { FollowupKicker } from '../_shared/followup/kick.ts';
import type { ScoreReads } from '../_shared/reminders/score-explain.ts';
import type { Translator } from '../_shared/speech/translate.ts';
import type { MunshiLine, ProxyDeps } from './sarvam-proxy.ts';

export interface CallsApiDeps extends ProxyDeps {
  /** Dashboard / phone page origins allowed to call the API from a browser. */
  readonly allowedOrigins: readonly string[];
  /** Wakes the follow-up worker for a call that just ended (M5); runs in the background. */
  readonly kickFollowup: FollowupKicker;
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
  readonly score: ScoreReads;
  /** Sarvam Translate for the transcript's English (M6); null when no Sarvam key is set. */
  readonly translate: Translator | null;
}

export interface RouteContext {
  readonly deps: CallsApiDeps;
  readonly cors: HeadersInit;
  /** Path parameters captured by the route pattern, URL-decoded. */
  readonly params: readonly string[];
}

export type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>;
