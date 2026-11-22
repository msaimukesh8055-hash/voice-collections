// supabase/functions/calls-api/__fixtures__/dashboard.ts
// Dashboard deps for tests (M6): the fake credit book, fake dashboard reads, a fixed link secret.
import type { ToneJudge } from '../../_shared/calls/tone-judge.ts';
import {
  fakeCallScoreRepository,
  type FakeCallScores,
} from '../../_shared/db/fake-call-score-repository.ts';
import { fakeExchangeReads } from '../../_shared/db/fake-exchange-reads.ts';
import type { ExchangeRow } from '../../_shared/db/exchange-repository.ts';
import { fakeTestDraftRepository } from '../../_shared/db/fake-test-draft-repository.ts';
import type { TestDraft } from '../../_shared/db/test-draft-repository.ts';
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
import { fakeOwnerCallReads, type SavedOwnerCall } from '../../_shared/db/fake-owner-call-reads.ts';
import type { OwnerCallDetail } from '../../_shared/db/owner-call-reads.ts';
import type { TranscriptClient } from '../../_shared/sarvam-analytics.ts';
import type { EvalCaseResult, EvalReads, EvalRun } from '../../_shared/db/eval-reads.ts';
import type { CallStatus } from '../../_shared/schemas/shopkeeper.ts';
import type { Translator } from '../../_shared/speech/translate.ts';
import type { DashboardDeps } from '../types.ts';

export const LINK_SECRET = 'dashboard-test-secret-of-32-characters!';

export interface DashboardSetup {
  readonly dashboard: DashboardDeps;
  readonly book: FakeBookState;
  readonly reads: FakeDashboardState;
  readonly ownerCalls: SavedOwnerCall;
  readonly scores: FakeCallScores;
  readonly drafts: TestDraft[];
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
    listOutcomes: (runIds) =>
      Promise.resolve(
        runIds.flatMap((runId) =>
          (evals.results[runId] ?? []).map((result) => ({
            runId,
            scenarioId: result.scenarioId,
            name: typeof result.scores['name'] === 'string' ? result.scores['name'] : '',
            pass: result.pass,
          }))
        ),
      ),
    getResult: (runId, scenarioId) =>
      Promise.resolve(
        (evals.results[runId] ?? []).find((result) => result.scenarioId === scenarioId) ?? null,
      ),
  };
}

export function dashboardSetup(
  options: {
    book?: Partial<FakeBookState>;
    reads?: Partial<FakeDashboardState>;
    ops?: Partial<FakeOpsState>;
    evals?: FakeEvals;
    translate?: Translator | null;
    ownerCalls?: readonly OwnerCallDetail[];
    munshiTranscripts?: TranscriptClient | null;
    judgeTone?: ToneJudge | null;
    callScores?: Partial<FakeCallScores>;
    exchanges?: readonly ExchangeRow[];
  } = {},
): DashboardSetup {
  const fakeBook = createFakeBookRepository(options.book);
  const fakeReads = createFakeDashboardRepository(options.reads);
  const owners = fakeOwnerCallReads(options.ownerCalls);
  const scores = fakeCallScoreRepository(options.callScores);
  const drafts = fakeTestDraftRepository();
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
    ownerCalls: owners.reads,
    munshiTranscripts: options.munshiTranscripts ?? null,
    judgeTone: options.judgeTone ?? null,
    callScores: scores.repo,
    testDrafts: drafts.repo,
    exchanges: fakeExchangeReads(options.exchanges),
  };
  return {
    dashboard,
    book: fakeBook.state,
    reads: fakeReads.state,
    ownerCalls: owners.saved,
    scores: scores.state,
    drafts: drafts.drafts,
  };
}
