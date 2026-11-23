// supabase/functions/_shared/db/fake-ops-repository.ts
// In-memory OpsRepository for tests (M9).
import type { HealthCheck } from '../ops/probe.ts';
import type {
  AlertClaim,
  OpsError,
  OpsRepository,
  OpsStatusRow,
  OpsSummary,
  TraceStep,
} from './ops-repository.ts';

export const EMPTY_OPS_SUMMARY: OpsSummary = {
  day: { requests: 0, failed: 0 },
  week: { requests: 0, failed: 0 },
  sources: [],
  tools: [],
  llm: [],
  tokens: [],
  paths: {},
  followups: { waiting: 0, stuck: 0, failedWeek: 0 },
  voice: {
    today: { liveMinutes: 0, simulatedCalls: 0 },
    month: { liveMinutes: 0, simulatedCalls: 0 },
  },
  recentErrors: [],
};

/** Nothing measured yet: no probe, no timer run, no outside call. */
export const EMPTY_OPS_STATUS: OpsStatusRow = {
  probes: {
    firstAt: null,
    dayTotal: 0,
    dayOk: 0,
    weekTotal: 0,
    weekOk: 0,
    allTotal: 0,
    allOk: 0,
    weekP95Ms: null,
  },
  lastProbe: null,
  jobRequests: [],
  jobs: [],
  errorGroups: [],
  providers: [],
  voice: { calls: 0, failed: 0, lastOkAt: null, lastFailedAt: null },
  whatsapp: {
    repliesSent: 0,
    repliesFailed: 0,
    lastOkAt: null,
    sendFailures: 0,
    lastFailedAt: null,
  },
  waReply: { messages: 0, p50Ms: null, p95Ms: null },
};

export interface FakeOpsState {
  readonly summary: OpsSummary;
  readonly status: OpsStatusRow;
  /** Health probes recorded so far. */
  healthChecks: readonly HealthCheck[];
  readonly traces: Readonly<Record<string, readonly TraceStep[]>>;
  readonly callSteps: Readonly<Record<string, readonly TraceStep[]>>;
  readonly errors: readonly OpsError[];
  /** Claims accepted so far; like the database, a second claim of a key in a window fails. */
  claims: readonly AlertClaim[];
}

export function createFakeOpsRepository(overrides: Partial<FakeOpsState> = {}): OpsRepository {
  const state: FakeOpsState = {
    summary: EMPTY_OPS_SUMMARY,
    status: EMPTY_OPS_STATUS,
    healthChecks: [],
    traces: {},
    callSteps: {},
    errors: [],
    claims: [],
    ...overrides,
  };
  return {
    listErrorsSince: (sinceIso) =>
      Promise.resolve(state.errors.filter((error) => error.createdAt >= sinceIso)),
    claimAlert: (claim) => {
      const taken = state.claims.some((old) =>
        old.key === claim.key && old.window === claim.window
      );
      if (!taken) state.claims = [...state.claims, claim];
      return Promise.resolve(!taken);
    },
    getSummary: () => Promise.resolve(state.summary),
    getStatus: () => Promise.resolve(state.status),
    recordHealthCheck: (check) => {
      state.healthChecks = [...state.healthChecks, check];
      return Promise.resolve();
    },
    listTraceSteps: (traceId) => Promise.resolve(state.traces[traceId] ?? []),
    listCallSteps: (callId) => Promise.resolve(state.callSteps[callId] ?? []),
  };
}
