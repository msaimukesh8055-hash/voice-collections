// scripts/seed/random.ts
// Seeded random numbers (mulberry32): the same seed always gives the same sequence, so the seed
// file is reproducible. Not for anything security-related.

export interface Random {
  /** 0 ≤ n < 1 */
  next(): number;
  /** Whole number from min to max, both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

const UINT32 = 2 ** 32;
const MULBERRY_INCREMENT = 0x6d2b79f5;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  function next(): number {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32;
  }
  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }
  function pick<T>(items: readonly T[]): T {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new Error('pick() needs at least one item');
    return item;
  }
  function chance(probability: number): boolean {
    return next() < probability;
  }
  function shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }
  return { next, int, pick, chance, shuffle };
}
