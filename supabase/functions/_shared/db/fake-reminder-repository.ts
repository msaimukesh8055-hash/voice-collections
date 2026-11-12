// supabase/functions/_shared/db/fake-reminder-repository.ts
// In-memory ReminderRepository for tests. FAKE DATA ONLY. Simulated calls keep the same rules as
// the database function: oldest queued first, at most `maxRunning` fresh ones in progress.
import type { AlertPromise } from '../ledger/due-alert.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { CallMode } from './repository.ts';
import type {
  CreatedCall,
  DailyAlertClaim,
  RecentCall,
  ReminderRepository,
} from './reminder-repository.ts';

export interface FakeQueuedCall {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly mode: CallMode;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly queuedAt: string;
  readonly acceptedAt: string | null;
  readonly transcript: readonly Turn[] | null;
  readonly followupPending: boolean;
}

export interface FakeReminderState {
  promises: readonly AlertPromise[];
  /** Calls made before the test (for "called in the last hour" and limits). */
  recentCalls: readonly RecentCall[];
  paused: readonly string[];
  doNotCall: readonly string[];
  calls: readonly FakeQueuedCall[];
  personas: Readonly<Record<string, string>>;
  alerts: readonly DailyAlertClaim[];
  lastInboundAt: string | null;
  /** What setCallsPaused last wrote; null until it is called. */
  callsPaused: boolean | null;
  /** Stands in for the database's now(). */
  clock: () => Date;
}

let callCounter = 0;
function nextCallId(): string {
  callCounter += 1;
  return `ca000000-0000-4000-8000-${String(callCounter).padStart(12, '0')}`;
}

function initialState(overrides: Partial<FakeReminderState>): FakeReminderState {
  return {
    promises: [],
    recentCalls: [],
    paused: [],
    doNotCall: [],
    calls: [],
    personas: {},
    alerts: [],
    lastInboundAt: null,
    callsPaused: null,
    clock: () => new Date('2026-11-02T06:30:00.000Z'),
    ...overrides,
  };
}

function update(
  state: FakeReminderState,
  callId: string,
  change: Partial<FakeQueuedCall>,
): void {
  state.calls = state.calls.map((call) => (call.callId === callId ? { ...call, ...change } : call));
}

function simulatedMethods(state: FakeReminderState): Pick<
  ReminderRepository,
  'claimSimulatedCall' | 'endStaleSimulatedCalls' | 'finishSimulatedCall'
> {
  const simulated = (status: FakeQueuedCall['status']): FakeQueuedCall[] =>
    state.calls.filter((call) => call.mode === 'simulated' && call.status === status);
  const isStale = (call: FakeQueuedCall, before: Date): boolean =>
    Date.parse(call.acceptedAt ?? call.queuedAt) < before.getTime();
  return {
    claimSimulatedCall: (maxRunning, staleBefore) => {
      const running = simulated('in_progress').filter((call) => !isStale(call, staleBefore));
      const next = [...simulated('queued')].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
      if (running.length >= maxRunning || !next) return Promise.resolve(null);
      update(state, next.callId, {
        status: 'in_progress',
        acceptedAt: state.clock().toISOString(),
      });
      return Promise.resolve(next.callId);
    },
    endStaleSimulatedCalls: (staleBefore) => {
      const stale = simulated('in_progress').filter((call) => isStale(call, staleBefore));
      stale.forEach((call) =>
        update(state, call.callId, { status: 'completed', followupPending: true })
      );
      return Promise.resolve(stale.map((call) => call.callId));
    },
    finishSimulatedCall: (callId, end) => {
      const found = simulated('in_progress').some((call) => call.callId === callId);
      if (found) {
        update(state, callId, {
          status: 'completed',
          transcript: end.transcript,
          followupPending: true,
        });
      }
      return Promise.resolve(found);
    },
  };
}

function reads(state: FakeReminderState): Omit<
  ReminderRepository,
  'createCalls' | 'claimSimulatedCall' | 'endStaleSimulatedCalls' | 'finishSimulatedCall'
> {
  return {
    listAlertPromises: (_ownerId, since) =>
      Promise.resolve(
        state.promises.filter((promise) =>
          promise.status === 'open' || promise.promiseDate >= since
        ),
      ),
    listCallsSince: (since) => {
      const all = [...state.recentCalls, ...state.calls];
      return Promise.resolve(all.filter((call) => Date.parse(call.queuedAt) >= since.getTime()));
    },
    listPausedShopkeepers: () => Promise.resolve(state.paused),
    listDoNotCall: () => Promise.resolve(state.doNotCall),
    getPersona: (shopkeeperId) => Promise.resolve(state.personas[shopkeeperId] ?? null),
    claimDailyAlert: (claim) => {
      const taken = state.alerts.some((alert) =>
        alert.ownerId === claim.ownerId && alert.day === claim.day
      );
      if (!taken) state.alerts = [...state.alerts, claim];
      return Promise.resolve(!taken);
    },
    lastInboundAt: () => Promise.resolve(state.lastInboundAt),
    setCallsPaused: (paused) => {
      state.callsPaused = paused;
      return Promise.resolve();
    },
  };
}

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeReminderRepository(overrides: Partial<FakeReminderState> = {}): {
  readonly reminders: ReminderRepository;
  readonly state: FakeReminderState;
} {
  const state = initialState(overrides);
  const reminders: ReminderRepository = {
    ...reads(state),
    ...simulatedMethods(state),
    createCalls: (calls) => {
      const queuedAt = state.clock().toISOString();
      const created: CreatedCall[] = calls.map((call) => ({
        callId: nextCallId(),
        shopkeeperId: call.shopkeeperId,
      }));
      const rows = created.map((call, index): FakeQueuedCall => ({
        ...call,
        mode: calls[index]?.mode ?? 'simulated',
        status: 'queued',
        queuedAt,
        acceptedAt: null,
        transcript: null,
        followupPending: false,
      }));
      state.calls = [...state.calls, ...rows];
      return Promise.resolve(created);
    },
  };
  return { reminders, state };
}
