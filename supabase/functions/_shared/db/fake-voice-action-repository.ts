// supabase/functions/_shared/db/fake-voice-action-repository.ts
// In-memory VoiceActionRepository for tests. FAKE DATA ONLY. Same rules as the Supabase one:
// newest first by created_at, compare-and-set status changes.
import type { VoiceAction, VoiceActionRepository } from './voice-action-repository.ts';

export interface FakeVoiceActionState {
  actions: readonly VoiceAction[];
}

function newestFirst(a: VoiceAction, b: VoiceAction): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeVoiceActionRepository(
  initial: readonly VoiceAction[] = [],
): { readonly actions: VoiceActionRepository; readonly state: FakeVoiceActionState } {
  const state: FakeVoiceActionState = { actions: initial };
  const ofCall = (ownerCallId: string): readonly VoiceAction[] =>
    state.actions.filter((action) => action.ownerCallId === ownerCallId);
  const actions: VoiceActionRepository = {
    countVoiceActions: (ownerCallId) => Promise.resolve(ofCall(ownerCallId).length),
    createVoiceAction: (input) => {
      const id = crypto.randomUUID();
      state.actions = [...state.actions, { ...input, id, status: 'open' }];
      return Promise.resolve(id);
    },
    cancelOpenVoiceActions: (ownerCallId, createdBefore) => {
      const cancels = (action: VoiceAction): boolean =>
        action.ownerCallId === ownerCallId && action.status === 'open' &&
        action.createdAt < createdBefore;
      const count = state.actions.filter(cancels).length;
      state.actions = state.actions.map((action): VoiceAction =>
        cancels(action) ? { ...action, status: 'cancelled' } : action
      );
      return Promise.resolve(count);
    },
    latestVoiceActions: (ownerCallId) =>
      Promise.resolve([...ofCall(ownerCallId)].sort(newestFirst).slice(0, 2)),
    getVoiceAction: (actionId) =>
      Promise.resolve(state.actions.find((action) => action.id === actionId) ?? null),
    transitionVoiceAction: (actionId, from, to) => {
      const found = state.actions.find((action) => action.id === actionId);
      if (!found || found.status !== from) return Promise.resolve(false);
      state.actions = state.actions.map((action): VoiceAction =>
        action.id === actionId ? { ...action, status: to } : action
      );
      return Promise.resolve(true);
    },
  };
  return { actions, state };
}
