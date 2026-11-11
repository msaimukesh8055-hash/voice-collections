// web/src/features/ops/opsFormat.test.ts
import { percent, sinceStart, statusOfRate } from './opsFormat.ts';

describe('opsFormat', () => {
  it('percent: whole numbers plain, others to one decimal, nothing to divide by is a dash', () => {
    expect(percent(1, 4)).toBe('25%');
    expect(percent(1, 40)).toBe('2.5%');
    expect(percent(1, 3)).toBe('33.3%');
    expect(percent(0, 10)).toBe('0%');
    expect(percent(0, 0)).toBe('–');
  });

  it('statusOfRate: none is good, up to 5% is a warning, above is bad', () => {
    expect(statusOfRate(0, 0)).toBe('plain');
    expect(statusOfRate(0, 50)).toBe('good');
    expect(statusOfRate(1, 20)).toBe('warn');
    expect(statusOfRate(2, 20)).toBe('bad');
  });

  it('sinceStart: milliseconds under a second, seconds above; never negative', () => {
    expect(sinceStart('2026-11-11T05:00:00.000Z', '2026-11-11T05:00:00.340Z')).toBe('+340 ms');
    expect(sinceStart('2026-11-11T05:00:00.000Z', '2026-11-11T05:00:01.250Z')).toBe('+1.25 s');
    expect(sinceStart('2026-11-11T05:00:01.000Z', '2026-11-11T05:00:00.000Z')).toBe('+0 ms');
  });
});
