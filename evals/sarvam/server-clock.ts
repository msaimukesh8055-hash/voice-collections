// evals/sarvam/server-clock.ts
// The gate runner's clock, taken from the database server instead of this computer. The runner
// dates every eval owner call by it, and the tool server checks those dates by its own clock: on
// 2026-11-20 this PC was about 4 minutes behind (Windows was not syncing it), so the 8-minute case
// started already past the 10-minute limit and was refused. One request at start-up; the
// server's Date header is whole seconds, which is close enough for minute-long limits.

/** How far the server's clock is ahead of this computer's, in ms (negative when behind). */
export async function serverClockOffsetMs(
  supabaseUrl: string,
  fetchImpl: typeof fetch,
  localNow: () => number = Date.now,
): Promise<number> {
  const sentAt = localNow();
  const reply = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`, { method: 'HEAD' });
  const receivedAt = localNow();
  const serverAt = Date.parse(reply.headers.get('date') ?? '');
  if (Number.isNaN(serverAt)) throw new Error('the database server sent no Date header');
  return serverAt - Math.round((sentAt + receivedAt) / 2);
}

/** A clock that reads server time: this computer's clock plus the measured offset. */
export function offsetClock(offsetMs: number, localNow: () => number = Date.now): () => Date {
  return function serverNow(): Date {
    return new Date(localNow() + offsetMs);
  };
}

/** Say so when this computer's clock is more than this far off the server's. */
const CLOCK_WARN_MS = 5_000;

/** Server time for a gate runner (Asha and Munshi), with a line when this computer is off. */
export async function serverClock(
  supabaseUrl: string,
  write: (line: string) => void,
): Promise<() => Date> {
  const offsetMs = await serverClockOffsetMs(supabaseUrl, fetch);
  if (Math.abs(offsetMs) > CLOCK_WARN_MS) {
    const seconds = Math.round(offsetMs / 1000);
    write(`This computer's clock is ${seconds} s off the server's; using server time.`);
  }
  return offsetClock(offsetMs);
}
