// supabase/functions/_shared/db/fake-ops-repository.ts
// In-memory OpsRepository for tests (M9).
import type {
  AlertClaim,
  OpsError,
  OpsRepository,
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

export interface FakeOpsState {
  readonly summary: OpsSummary;
  readonly traces: Readonly<Record<string, readonly TraceStep[]>>;
  readonly errors: readonly OpsError[];
  /** Claims accepted so far; like the database, a second claim of a key in a window fails. */
  claims: readonly AlertClaim[];
}

export function createFakeOpsRepository(overrides: Partial<FakeOpsState> = {}): OpsRepository {
  const state: FakeOpsState = {
    summary: EMPTY_OPS_SUMMARY,
    traces: {},
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
    listTraceSteps: (traceId) => Promise.resolve(state.traces[traceId] ?? []),
  };
}
