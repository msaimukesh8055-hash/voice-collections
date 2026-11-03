// supabase/functions/_shared/followup/transcript-step.test.ts
// Transcript (M5 test list): found → used; lagging → retried; 10 minutes → from tool events.
import { assertEquals } from '@std/assert';
import type { FollowupCall } from '../db/followup-repository.ts';
import type { TimeWindow, TranscriptClient, TranscriptResult } from '../sarvam-analytics.ts';
import { resolveTranscript } from './transcript-step.ts';
import { followupCall } from './__fixtures__/followup-call.ts';

const TURNS = [{ role: 'user', content: 'Hello' }] as const;
const ENDED = Date.parse('2026-11-02T06:32:00.000Z');

function client(result: TranscriptResult, found: string | null = null): {
  client: TranscriptClient;
  windows: TimeWindow[];
  fetched: string[];
} {
  const windows: TimeWindow[] = [];
  const fetched: string[] = [];
  return {
    windows,
    fetched,
    client: {
      fetchTranscript: (id) => {
        fetched.push(id);
        return Promise.resolve(result);
      },
      findInteractionId: (_token, window) => {
        windows.push(window);
        return Promise.resolve(found);
      },
    },
  };
}

function at(minutesAfterEnd: number): Date {
  return new Date(ENDED + minutesAfterEnd * 60_000);
}

Deno.test('transcript step › found → used', async () => {
  const fake = client({ kind: 'ready', turns: TURNS });
  assertEquals(await resolveTranscript(followupCall(), fake.client, at(1)), {
    kind: 'ready',
    turns: TURNS,
    foundInteractionId: null,
  });
  assertEquals(fake.fetched, ['20261102/abc-21:45:10-x']);
});

Deno.test('transcript step › lagging → wait, until 10 minutes after the call ended', async () => {
  for (const result of [{ kind: 'not_ready' }, { kind: 'failed', reason: 'HTTP 500' }] as const) {
    const fake = client(result);
    assertEquals((await resolveTranscript(followupCall(), fake.client, at(9.9))).kind, 'wait');
    assertEquals((await resolveTranscript(followupCall(), fake.client, at(10))).kind, 'missing');
  }
});

Deno.test('transcript step › no interaction id: looked up by call token around the call', async () => {
  const fake = client({ kind: 'ready', turns: TURNS }, '20261102/found');
  const call: FollowupCall = followupCall({ interactionId: null });
  const step = await resolveTranscript(call, fake.client, at(1));
  assertEquals(step, { kind: 'ready', turns: TURNS, foundInteractionId: '20261102/found' });
  assertEquals(fake.windows[0], {
    from: new Date('2026-11-02T06:27:00.000Z'),
    to: new Date('2026-11-02T06:33:00.000Z'),
  });
});

Deno.test('transcript step › id not found → wait, then missing', async () => {
  const fake = client({ kind: 'ready', turns: TURNS }, null);
  const call = followupCall({ interactionId: null, acceptedAt: null, endedAt: null });
  assertEquals((await resolveTranscript(call, fake.client, at(0))).kind, 'wait');
  assertEquals(fake.fetched, []);
});

Deno.test('transcript step › not answered → none; simulated → stored transcript', async () => {
  const fake = client({ kind: 'ready', turns: TURNS });
  for (const status of ['declined', 'missed'] as const) {
    assertEquals(await resolveTranscript(followupCall({ status }), fake.client, at(0)), {
      kind: 'none',
    });
  }
  const simulated = followupCall({ mode: 'simulated', transcript: TURNS });
  assertEquals((await resolveTranscript(simulated, fake.client, at(0))).kind, 'ready');
  const empty = followupCall({ mode: 'simulated', transcript: null });
  assertEquals((await resolveTranscript(empty, fake.client, at(0))).kind, 'missing');
  assertEquals(fake.fetched, []);
});
