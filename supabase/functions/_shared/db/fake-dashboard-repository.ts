// supabase/functions/_shared/db/fake-dashboard-repository.ts
// In-memory DashboardRepository for tests (M6).
import type {
  DashboardCall,
  DashboardCallDetail,
  DashboardNote,
  DashboardPromise,
  DashboardRepository,
} from './dashboard-repository.ts';

export interface FakeDashboardState {
  calls: readonly DashboardCallDetail[];
  promises: Readonly<Record<string, readonly DashboardPromise[]>>;
  notes: Readonly<Record<string, readonly DashboardNote[]>>;
  englishUnderTelugu: Readonly<Record<string, boolean>>;
}

function plain(call: DashboardCallDetail): DashboardCall {
  const { transcript: _t, toolEvents: _e, followup: _f, ...rest } = call;
  return rest;
}

export function createFakeDashboardRepository(
  overrides: Partial<FakeDashboardState> = {},
): { readonly reads: DashboardRepository; readonly state: FakeDashboardState } {
  const state: FakeDashboardState = {
    calls: [],
    promises: {},
    notes: {},
    englishUnderTelugu: {},
    ...overrides,
  };
  const reads: DashboardRepository = {
    listCalls: ({ limit, shopkeeperId }) =>
      Promise.resolve(
        state.calls
          .filter((call) => !shopkeeperId || call.shopkeeperId === shopkeeperId)
          .slice(0, limit)
          .map(plain),
      ),
    getCall: (callId) => Promise.resolve(state.calls.find((call) => call.id === callId) ?? null),
    listPromises: (shopkeeperId) => Promise.resolve(state.promises[shopkeeperId] ?? []),
    listNotes: (shopkeeperId, limit) =>
      Promise.resolve((state.notes[shopkeeperId] ?? []).slice(0, limit)),
    setEnglishUnderTelugu: (ownerId, on) => {
      state.englishUnderTelugu = { ...state.englishUnderTelugu, [ownerId]: on };
      return Promise.resolve();
    },
  };
  return { reads, state };
}
