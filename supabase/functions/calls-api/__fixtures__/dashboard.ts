// supabase/functions/calls-api/__fixtures__/dashboard.ts
// Dashboard deps for tests (M6): the fake credit book, fake dashboard reads, a fixed link secret.
import {
  createFakeBookRepository,
  type FakeBookState,
} from '../../_shared/db/fake-book-repository.ts';
import {
  createFakeDashboardRepository,
  type FakeDashboardState,
} from '../../_shared/db/fake-dashboard-repository.ts';
import {
  createFakeOpsRepository,
  type FakeOpsState,
} from '../../_shared/db/fake-ops-repository.ts';
import type { EvalCaseResult, EvalReads, EvalRun } from '../../_shared/db/eval-reads.ts';
import type { CallStatus } from '../../_shared/schemas/shopkeeper.ts';
import type { Translator } from '../../_shared/speech/translate.ts';
import type { DashboardDeps } from '../types.ts';

export const LINK_SECRET = 'dashboard-test-secret-of-32-characters!';

export interface DashboardSetup {
  readonly dashboard: DashboardDeps;
  readonly book: FakeBookState;
  readonly reads: FakeDashboardState;
}

/** Stored eval runs (newest first) and each run's case results, for tests. */
export interface FakeEvals {
  readonly runs: readonly EvalRun[];
  readonly results: Readonly<Record<string, readonly EvalCaseResult[]>>;
}

function fakeEvalReads(evals: FakeEvals = { runs: [], results: {} }): EvalReads {
  return {
    listRuns: (limit) => Promise.resolve(evals.runs.slice(0, limit)),
    listResults: (runId) => Promise.resolve(evals.results[runId] ?? []),
  };
}

export function dashboardSetup(
  options: {
    book?: Partial<FakeBookState>;
    reads?: Partial<FakeDashboardState>;
    ops?: Partial<FakeOpsState>;
    evals?: FakeEvals;
    translate?: Translator | null;
  } = {},
): DashboardSetup {
  const fakeBook = createFakeBookRepository(options.book);
  const fakeReads = createFakeDashboardRepository(options.reads);
  const dashboard: DashboardDeps = {
    linkSecret: LINK_SECRET,
    book: fakeBook.book,
    reads: fakeReads.reads,
    ops: createFakeOpsRepository(options.ops),
    evals: fakeEvalReads(options.evals),
    score: {
      listPromises: () => Promise.resolve([]),
      listCallStatuses: (): Promise<readonly CallStatus[]> => Promise.resolve([]),
    },
    translate: options.translate === undefined ? null : options.translate,
  };
  return { dashboard, book: fakeBook.state, reads: fakeReads.state };
}
