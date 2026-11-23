// supabase/functions/_shared/db/ops-repository.ts
// What the ops page reads (M9 Build A): one summary worked out in the database (ops_summary) and
// the steps of one trace. Counts, timings and codes only; never names, numbers or amounts.
import type { HealthCheck } from '../ops/probe.ts';
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

/** Ops redesign (2026-11-23): health probes, timers, grouped errors and outside services, as
 * ops_status() counts them. Times are ISO strings; null when nothing happened yet. */
export interface ProbeCounts {
  readonly firstAt: string | null;
  readonly dayTotal: number;
  readonly dayOk: number;
  readonly weekTotal: number;
  readonly weekOk: number;
  readonly allTotal: number;
  readonly allOk: number;
  readonly weekP95Ms: number | null;
}

export interface LastProbe {
  readonly checkedAt: string;
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly database: 'ok' | 'fail' | null;
  readonly version: string | null;
  readonly errorCode: string | null;
}

/** A timer's requests as the follow-up worker saw them (by route). */
export interface JobRequests {
  readonly route: string;
  readonly dayRuns: number;
  readonly dayFailed: number;
  readonly weekRuns: number;
  readonly lastAt: string | null;
}

/** A pg_cron job and what pg_cron recorded about its runs. */
export interface CronJob {
  readonly name: string;
  readonly schedule: string;
  readonly active: boolean;
  readonly lastRunAt: string | null;
  readonly lastStatus: string | null;
  readonly dayRuns: number;
  readonly dayFailed: number;
}

export interface ErrorGroup {
  readonly source: string;
  readonly step: string;
  readonly errorCode: string | null;
  readonly count: number;
  readonly lastAt: string;
  readonly traceId: string;
}

export interface ServiceUse {
  readonly calls: number;
  readonly failed: number;
  readonly lastOkAt: string | null;
  readonly lastFailedAt: string | null;
}

export interface OpsStatusRow {
  readonly probes: ProbeCounts;
  readonly lastProbe: LastProbe | null;
  readonly jobRequests: readonly JobRequests[];
  readonly jobs: readonly CronJob[];
  readonly errorGroups: readonly ErrorGroup[];
  readonly providers: readonly (ServiceUse & { readonly provider: string })[];
  readonly voice: ServiceUse;
  readonly whatsapp: {
    readonly repliesSent: number;
    readonly repliesFailed: number;
    /** When a reply to the owner last went through. */
    readonly lastOkAt: string | null;
    readonly sendFailures: number;
    readonly lastFailedAt: string | null;
  };
  readonly waReply: {
    readonly messages: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
  };
}

export interface OpsRepository {
  getSummary(): Promise<OpsSummary>;
  /** Ops redesign: the numbers behind status, targets, services, timers and grouped errors. */
  getStatus(): Promise<OpsStatusRow>;
  /** One health probe's result (health_checks). */
  recordHealthCheck(check: HealthCheck): Promise<void>;
  /** Error steps since `sinceIso`, newest first, capped. */
  listErrorsSince(sinceIso: string): Promise<readonly OpsError[]>;
  /** True for the first claim of a problem in a window; false when it was already alerted. */
  claimAlert(claim: AlertClaim): Promise<boolean>;
  /** Oldest first; empty when the trace is unknown or older than the two-week clean-up. */
  listTraceSteps(traceId: string): Promise<readonly TraceStep[]>;
  /** Live evals: every step of every trace that names this call (detail.callId, or
   * detail.ownerCallId for Munshi's calls), oldest first,
   * without the timers' own sweep requests. Empty when none is left (two-week clean-up). */
  listCallSteps(callId: string): Promise<readonly TraceStep[]>;
}
