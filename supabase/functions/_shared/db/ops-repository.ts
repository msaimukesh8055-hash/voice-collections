// supabase/functions/_shared/db/ops-repository.ts
// What the ops page reads (M9 Build A): one summary worked out in the database (ops_summary) and
// the steps of one trace. Counts, timings and codes only; never names, numbers or amounts.
import type { OpsStatus } from '../ops/trace.ts';

export interface RequestCount {
  readonly requests: number;
  /** Requests whose trace has at least one error step. */
  readonly failed: number;
}

export interface SourceStats extends RequestCount {
  readonly source: string;
  readonly p95Ms: number | null;
}

export interface ToolStats {
  readonly agent: 'asha' | 'munshi';
  readonly tool: string;
  readonly calls: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface LlmStats {
  readonly provider: string;
  readonly answers: number;
  /** Answers the parser refused ("bad_json"); the next provider was asked instead. */
  readonly rejected: number;
  /** Timeouts, HTTP errors and unexpected reply shapes. */
  readonly failed: number;
}

export interface TokenUse {
  readonly provider: string;
  readonly today: { readonly input: number; readonly output: number };
  readonly month: { readonly input: number; readonly output: number };
}

export interface FollowupQueue {
  readonly waiting: number;
  /** Waiting for more than 10 minutes past their time: something is wrong. */
  readonly stuck: number;
  readonly failedWeek: number;
}

export interface VoiceUse {
  readonly liveMinutes: number;
  readonly simulatedCalls: number;
}

export interface OpsError {
  readonly traceId: string;
  readonly source: string;
  readonly step: string;
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface OpsSummary {
  readonly day: RequestCount;
  readonly week: RequestCount;
  /** Per Edge Function, last 24 hours. */
  readonly sources: readonly SourceStats[];
  /** Per agent tool, last 7 days. */
  readonly tools: readonly ToolStats[];
  readonly llm: readonly LlmStats[];
  readonly tokens: readonly TokenUse[];
  /** How incoming WhatsApp messages were answered, last 7 days (button, command, sarvam…). */
  readonly paths: Readonly<Record<string, number>>;
  readonly followups: FollowupQueue;
  readonly voice: { readonly today: VoiceUse; readonly month: VoiceUse };
  readonly recentErrors: readonly OpsError[];
}

export interface TraceStep {
  readonly source: string;
  readonly step: string;
  readonly status: OpsStatus;
  readonly errorCode: string | null;
  readonly provider: string | null;
  readonly durationMs: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/** One problem's claim on a 15-minute alert window (ops/watch.ts). */
export interface AlertClaim {
  readonly key: string;
  /** Whole 15-minute windows since 1970. */
  readonly window: number;
  readonly count: number;
  readonly traceId: string | null;
}

export interface OpsRepository {
  getSummary(): Promise<OpsSummary>;
  /** Error steps since `sinceIso`, newest first, capped. */
  listErrorsSince(sinceIso: string): Promise<readonly OpsError[]>;
  /** True for the first claim of a problem in a window; false when it was already alerted. */
  claimAlert(claim: AlertClaim): Promise<boolean>;
  /** Oldest first; empty when the trace is unknown or older than the two-week clean-up. */
  listTraceSteps(traceId: string): Promise<readonly TraceStep[]>;
}
