// supabase/functions/_shared/followup/__fixtures__/followup-call.ts
// A finished live call waiting for its follow-up. FAKE DATA ONLY: Ramesh, Mon 2 Nov, ended 12:02
// IST, identity confirmed, tone level 2.
import type { FollowupCall } from '../../db/followup-repository.ts';

export const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';

export function followupCall(overrides: Partial<FollowupCall> = {}): FollowupCall {
  return {
    callId: CALL_ID,
    shopkeeperId: '5e000000-0000-4000-8000-000000000001',
    mode: 'live',
    status: 'completed',
    identityStatus: 'confirmed',
    toneLevel: 2,
    interactionId: '20261102/abc-21:45:10-x',
    transcript: null,
    queuedAt: '2026-11-02T06:28:00.000Z',
    acceptedAt: '2026-11-02T06:29:00.000Z',
    endedAt: '2026-11-02T06:32:00.000Z',
    followupStatus: 'pending',
    followupAttempts: 0,
    followupNextAt: '2026-11-02T06:32:00.000Z',
    followupClaimedAt: null,
    ...overrides,
  };
}
