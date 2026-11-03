// supabase/functions/_shared/db/fake-followup-repository.ts
// In-memory FollowupRepository for tests. FAKE DATA ONLY. Mirrors the database rules that matter:
// claiming is a compare-and-set on status + attempts, one run and one note per call.
import type { Score } from '../ledger/score.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import {
  type CallOutcome,
  type FinishedFollowup,
  type FollowupCall,
  type FollowupRepository,
  type NewFollowup,
  type NewFollowupRun,
  type NewNote,
  staleBefore,
} from './followup-repository.ts';

export interface FakeFollowupState {
  calls: readonly FollowupCall[];
  outcomes: Readonly<Record<string, CallOutcome>>;
  callStatuses: Readonly<Record<string, readonly CallStatus[]>>;
  runs: readonly NewFollowupRun[];
  notes: readonly NewNote[];
  followups: readonly NewFollowup[];
  scores: readonly { readonly shopkeeperId: string; readonly score: Score }[];
  finished: readonly { readonly callId: string; readonly result: FinishedFollowup }[];
}

export const NO_OUTCOME: CallOutcome = { promise: null, claim: null, callbacks: [] };

function isDue(call: FollowupCall, now: Date): boolean {
  if (call.followupStatus === 'pending') {
    return call.followupNextAt !== null && Date.parse(call.followupNextAt) <= now.getTime();
  }
  return call.followupStatus === 'running' && call.followupClaimedAt !== null &&
    Date.parse(call.followupClaimedAt) < staleBefore(now).getTime();
}

function callMethods(state: FakeFollowupState): Pick<
  FollowupRepository,
  | 'getFollowupCall'
  | 'claimFollowup'
  | 'releaseFollowup'
  | 'failFollowup'
  | 'finishFollowup'
  | 'listDueFollowups'
> {
  const update = (callId: string, change: Partial<FollowupCall>): void => {
    state.calls = state.calls.map((call) => call.callId === callId ? { ...call, ...change } : call);
  };
  return {
    getFollowupCall: (callId) =>
      Promise.resolve(state.calls.find((call) => call.callId === callId) ?? null),
    claimFollowup: (expected, now) => {
      const current = state.calls.find((call) => call.callId === expected.callId);
      const matches = current?.followupStatus === expected.followupStatus &&
        current.followupAttempts === expected.followupAttempts;
      if (!matches) return Promise.resolve(false);
      update(expected.callId, {
        followupStatus: 'running',
        followupAttempts: expected.followupAttempts + 1,
        followupClaimedAt: now.toISOString(),
      });
      return Promise.resolve(true);
    },
    releaseFollowup: (callId, nextAt) => {
      update(callId, { followupStatus: 'pending', followupNextAt: nextAt.toISOString() });
      return Promise.resolve();
    },
    failFollowup: (callId) => {
      update(callId, { followupStatus: 'failed' });
      return Promise.resolve();
    },
    finishFollowup: (callId, result) => {
      update(callId, { followupStatus: 'done' });
      state.finished = [...state.finished, { callId, result }];
      return Promise.resolve();
    },
    listDueFollowups: (now, limit) =>
      Promise.resolve(
        state.calls.filter((call) => isDue(call, now)).map((call) => call.callId).slice(0, limit),
      ),
  };
}

function writeMethods(state: FakeFollowupState): Pick<
  FollowupRepository,
  'insertFollowupRun' | 'insertNote' | 'insertFollowup' | 'saveScore'
> {
  return {
    insertFollowupRun: (run) => {
      if (state.runs.some((saved) => saved.callId === run.callId)) return Promise.resolve(false);
      state.runs = [...state.runs, run];
      return Promise.resolve(true);
    },
    insertNote: (note) => {
      if (state.notes.some((saved) => saved.callId === note.callId)) return Promise.resolve(false);
      state.notes = [...state.notes, note];
      return Promise.resolve(true);
    },
    insertFollowup: (followup) => {
      state.followups = [...state.followups, followup];
      return Promise.resolve();
    },
    saveScore: (shopkeeperId, score) => {
      state.scores = [...state.scores, { shopkeeperId, score }];
      return Promise.resolve();
    },
  };
}

export function createFakeFollowupRepository(overrides: Partial<FakeFollowupState> = {}): {
  readonly followups: FollowupRepository;
  readonly state: FakeFollowupState;
} {
  const state: FakeFollowupState = {
    calls: [],
    outcomes: {},
    callStatuses: {},
    runs: [],
    notes: [],
    followups: [],
    scores: [],
    finished: [],
    ...overrides,
  };
  const followups: FollowupRepository = {
    ...callMethods(state),
    ...writeMethods(state),
    getCallOutcome: (callId) => Promise.resolve(state.outcomes[callId] ?? NO_OUTCOME),
    listCallStatuses: (shopkeeperId) => Promise.resolve(state.callStatuses[shopkeeperId] ?? []),
  };
  return { followups, state };
}
