// supabase/functions/_shared/db/fake-owner-call-reads.ts
// In-memory OwnerCallReads for tests. FAKE DATA ONLY: one completed call of Srinivas's to Munshi.
import type { ToneJudgement } from '../calls/tone-judge.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { FAKE_OWNER_CALL_ID } from './fake-owner-call-repository.ts';
import type { OwnerCallDetail, OwnerCallReads } from './owner-call-reads.ts';

export function fakeOwnerCallDetail(overrides: Partial<OwnerCallDetail> = {}): OwnerCallDetail {
  return {
    id: FAKE_OWNER_CALL_ID,
    status: 'completed',
    issuedAt: '2026-11-20T04:59:00Z',
    acceptedAt: '2026-11-20T05:00:00Z',
    endedAt: '2026-11-20T05:02:20Z',
    durationSeconds: 140,
    isTest: false,
    interactionId: '20261120/munshi-1',
    transcript: null,
    transcriptEnglish: null,
    toneJudgement: null,
    toolEvents: [
      {
        tool: 'lookup_shopkeeper',
        args: { name: 'Ramesh' },
        result: { ok: true, say: '', data: { outstanding: 8000 } },
        durationMs: 210,
        createdAt: '2026-11-20T05:00:30Z',
      },
    ],
    ...overrides,
  };
}

export interface SavedOwnerCall {
  transcript: readonly Turn[] | null;
  english: readonly (string | null)[] | null;
  tone: ToneJudgement | null;
}

export function fakeOwnerCallReads(
  calls: readonly OwnerCallDetail[] = [fakeOwnerCallDetail()],
): { readonly reads: OwnerCallReads; readonly saved: SavedOwnerCall } {
  const saved: SavedOwnerCall = { transcript: null, english: null, tone: null };
  const reads: OwnerCallReads = {
    listOwnerCalls: (_ownerId, limit) => Promise.resolve(calls.slice(0, limit)),
    getOwnerCallDetail: (ownerCallId) =>
      Promise.resolve(calls.find((call) => call.id === ownerCallId) ?? null),
    saveOwnerCallTranscript(_ownerCallId, turns): Promise<void> {
      saved.transcript = turns;
      return Promise.resolve();
    },
    saveOwnerCallEnglish(_ownerCallId, lines): Promise<void> {
      saved.english = lines;
      return Promise.resolve();
    },
    saveOwnerCallTone(_ownerCallId, judgement): Promise<void> {
      saved.tone = judgement;
      return Promise.resolve();
    },
  };
  return { reads, saved };
}
