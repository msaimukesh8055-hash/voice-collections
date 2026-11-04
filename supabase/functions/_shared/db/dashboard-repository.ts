// supabase/functions/_shared/db/dashboard-repository.ts
// What the web dashboard reads (M6, SPEC §12) beyond the credit book: calls with their
// transcript, tool calls and follow-up decision, a shopkeeper's promises and notes, and the one
// setting it can change ("English under Telugu"). Read-only otherwise. Service role, RLS on.
import type { Turn } from '../sarvam-analytics.ts';
import type { CallStatus, Language } from '../schemas/shopkeeper.ts';

export interface DashboardCall {
  readonly id: string;
  readonly shopkeeperId: string;
  readonly mode: 'live' | 'simulated';
  readonly status: CallStatus;
  readonly language: Language;
  readonly toneLevel: number;
  readonly queuedAt: string;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  /** The after-call summary the follow-up worker wrote, when it ran. */
  readonly summary: string | null;
}

export interface DashboardToolEvent {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly durationMs: number | null;
  readonly createdAt: string;
}

export interface DashboardFollowupRun {
  readonly path: 'rule' | 'agent';
  readonly decision: string;
  readonly reasoning: string;
}

export interface DashboardCallDetail extends DashboardCall {
  readonly transcript: readonly Turn[] | null;
  readonly toolEvents: readonly DashboardToolEvent[];
  readonly followup: DashboardFollowupRun | null;
}

export interface DashboardPromise {
  readonly amount: number;
  readonly promiseDate: string;
  readonly status: 'open' | 'kept' | 'broken' | 'replaced';
  readonly createdAt: string;
}

export interface DashboardNote {
  readonly note: string;
  readonly createdAt: string;
}

export interface DashboardRepository {
  /** Newest first; one shopkeeper's only when `shopkeeperId` is given. */
  listCalls(options: { limit: number; shopkeeperId?: string }): Promise<readonly DashboardCall[]>;
  getCall(callId: string): Promise<DashboardCallDetail | null>;
  listPromises(shopkeeperId: string): Promise<readonly DashboardPromise[]>;
  listNotes(shopkeeperId: string, limit: number): Promise<readonly DashboardNote[]>;
  setEnglishUnderTelugu(ownerId: string, on: boolean): Promise<void>;
}
