// evals/sarvam/server-clock.test.ts
// The gate runner reads time from the database server, so a wrong PC clock (4 minutes behind on
// 2026-11-20) cannot start the eval calls already expired. FAKE DATA ONLY.
import { describe, expect, it } from 'vitest';
import { offsetClock, serverClockOffsetMs } from './server-clock.ts';

function replyAt(date: string): typeof fetch {
  return function fakeFetch(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 200, headers: { date } }));
  };
}

describe('server clock', () => {
  it('measures how far the server is ahead of this computer', async () => {
    const local = Date.parse('2026-11-20T11:35:00.000Z');
    const offset = await serverClockOffsetMs(
      'https://db.test',
      replyAt('Fri, 20 Nov 2026 11:39:05 GMT'),
      () => local,
    );
    expect(offset).toBe(245_000);
    expect(offsetClock(offset, () => local)().toISOString()).toBe('2026-11-20T11:39:05.000Z');
  });

  it('refuses a reply with no Date header rather than guessing', async () => {
    const noDate: typeof fetch = () => Promise.resolve(new Response(null, { status: 200 }));
    await expect(serverClockOffsetMs('https://db.test', noDate)).rejects.toThrow('no Date header');
  });
});
