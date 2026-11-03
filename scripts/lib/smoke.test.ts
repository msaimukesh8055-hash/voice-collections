// scripts/lib/smoke.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReporter, poll, requireEnv } from './smoke.ts';

const NAME = 'SMOKE_TEST_FAKE_VALUE';

describe('requireEnv', () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, NAME);
  });

  it('returns the trimmed value (Windows line endings removed)', () => {
    process.env[NAME] = ' fake-value\r ';
    expect(requireEnv(NAME)).toBe('fake-value');
  });

  it('names a missing value without printing anything else', () => {
    expect(() => requireEnv(NAME)).toThrow(`Missing ${NAME} in .env`);
  });
});

describe('createReporter', () => {
  it('prints ok/FAIL lines and counts failures', () => {
    const lines: string[] = [];
    function write(text: string): void {
      lines.push(text);
    }
    const reporter = createReporter(write);
    reporter.report(true, 'first');
    reporter.report(false, 'second');
    expect(lines).toEqual(['ok   first\n', 'FAIL second\n']);
    expect(reporter.failures()).toBe(1);
  });

  it('prints to stdout by default', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    createReporter().report(true, 'default');
    expect(spy).toHaveBeenCalledWith('ok   default\n');
    spy.mockRestore();
  });
});

describe('poll', () => {
  it('returns the first non-null value', async () => {
    let reads = 0;
    function read(): Promise<number | null> {
      reads += 1;
      return Promise.resolve(reads === 3 ? 42 : null);
    }
    expect(await poll(read, { tries: 5, delayMs: 1 })).toBe(42);
    expect(reads).toBe(3);
  });

  it('gives up with null after the last try', async () => {
    let reads = 0;
    function read(): Promise<null> {
      reads += 1;
      return Promise.resolve(null);
    }
    expect(await poll(read, { tries: 2, delayMs: 1 })).toBeNull();
    expect(reads).toBe(2);
  });
});
