// scripts/lib/smoke.ts
// Small helpers shared by the deployed smoke scripts: read a required .env value, print ok/FAIL
// lines and count failures, and poll for background work that finishes after the HTTP reply.
// Never prints a value read from .env.

export function requireEnv(name: string): string {
  const value = process.env[name]?.replace(/\r/g, '').trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

export interface Reporter {
  readonly report: (passed: boolean, line: string) => void;
  readonly failures: () => number;
}

export function createReporter(
  write: (text: string) => void = (text) => process.stdout.write(text),
): Reporter {
  let failures = 0;
  return {
    report(passed, line): void {
      if (!passed) failures += 1;
      write(`${passed ? 'ok  ' : 'FAIL'} ${line}\n`);
    },
    failures: () => failures,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollOptions {
  readonly tries: number;
  readonly delayMs: number;
}

/** Reads until the value is not null, up to `tries` times; null if it never arrived. */
export async function poll<T>(
  read: () => Promise<T | null>,
  options: PollOptions,
): Promise<T | null> {
  for (let attempt = 0; attempt < options.tries; attempt += 1) {
    const value = await read();
    if (value !== null) return value;
    if (attempt < options.tries - 1) await sleep(options.delayMs);
  }
  return null;
}
