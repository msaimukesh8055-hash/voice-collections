// scripts/seed/generate-seed.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addDays } from '../../supabase/functions/_shared/clock.ts';
import { computeDues } from '../../supabase/functions/_shared/ledger/dues.ts';
import type { LedgerEntry } from '../../supabase/functions/_shared/schemas/ledger.ts';
import {
  fakePhone,
  generateSeed,
  HISTORY_DAYS,
  outstandingOf,
  PROFILE_COUNTS,
  type SeedEntry,
  shopkeeperId,
} from './generate-seed.ts';
import { RAMESH_STORY } from './ramesh.ts';
import { createRandom } from './random.ts';
import { dayExpression, renderSeedSql } from './render-sql.ts';

const data = generateSeed();
const sql = renderSeedSql(data);
const TODAY = '2026-11-02';

function toLedger(entries: readonly SeedEntry[]): LedgerEntry[] {
  return entries.map((entry) => ({
    kind: entry.kind,
    amount: entry.amount,
    entryDate: addDays(TODAY, entry.day),
    dueDate: entry.dueDay === null ? null : addDays(TODAY, entry.dueDay),
    status: entry.status,
  }));
}

function entriesOf(id: string): SeedEntry[] {
  return data.entries.filter((entry) => entry.shopkeeperId === id);
}

describe('seed generator', () => {
  it('gives an identical file for the same seed, matching the committed seed.sql', () => {
    expect(renderSeedSql(generateSeed())).toBe(sql);
    expect(readFileSync('supabase/seed.sql', 'utf8')).toBe(sql);
  });

  it('gives a different book for a different seed', () => {
    expect(renderSeedSql(generateSeed(1))).not.toBe(sql);
  });

  it('has 100 shopkeepers with unique ids and unique shop names', () => {
    expect(data.shopkeepers).toHaveLength(100);
    expect(new Set(data.shopkeepers.map((s) => s.id)).size).toBe(100);
    expect(new Set(data.shopkeepers.map((s) => s.shopName)).size).toBe(100);
    expect(sql.match(/insert into public\.owners/g)).toHaveLength(1);
  });

  it('spreads the behaviour profiles 40 / 30 / 20 / 10', () => {
    const counts = Object.fromEntries(
      Object.keys(PROFILE_COUNTS).map((profile) => [
        profile,
        data.shopkeepers.filter((s) => s.profile === profile).length,
      ]),
    );
    expect(counts).toEqual(PROFILE_COUNTS);
  });

  it('never lets a balance go negative, day by day', () => {
    for (const shopkeeper of data.shopkeepers) {
      const confirmed = entriesOf(shopkeeper.id)
        .filter((entry) => entry.status === 'confirmed')
        .sort((a, b) => a.day - b.day || (a.kind === 'credit' ? -1 : 1));
      let balance = 0;
      for (const entry of confirmed) {
        balance += entry.kind === 'credit' ? entry.amount : -entry.amount;
        expect(balance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps every date within the last 6 months (due dates and open promises up to 2 weeks ahead)', () => {
    const days = data.entries.map((entry) => entry.day);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(-HISTORY_DAYS);
    expect(Math.max(...days)).toBeLessThanOrEqual(-1);
    const dueDays = data.entries.flatMap((entry) => (entry.dueDay === null ? [] : [entry.dueDay]));
    expect(Math.max(...dueDays)).toBeLessThanOrEqual(14);
    const promiseDays = data.promises.flatMap((p) => (p.day === 'last_friday' ? [] : [p.day]));
    expect(Math.min(...promiseDays)).toBeGreaterThanOrEqual(-HISTORY_DAYS);
    expect(Math.max(...promiseDays)).toBeLessThanOrEqual(14);
  });

  it("tells Ramesh's story: ₹8,500 = ₹5,000 overdue 12 days + ₹3,500 due in 3 days", () => {
    const dues = computeDues(toLedger(entriesOf(shopkeeperId(0))), TODAY);
    expect(dues.outstanding).toBe(RAMESH_STORY.outstanding);
    expect([dues.overdueAmount, dues.daysOverdue]).toEqual([5000, 12]);
    expect([dues.nextDueAmount, dues.nextDueDate]).toEqual([3500, addDays(TODAY, 3)]);
    expect(data.shopkeepers[0]).toMatchObject({
      name: 'Ramesh',
      shopName: 'Ramesh Kirana',
      language: 'te',
    });
  });

  it("has Ramesh's broken ₹3,000 promise for last Friday, and only one broken promise", () => {
    const rameshPromises = data.promises.filter((p) => p.shopkeeperId === shopkeeperId(0));
    expect(rameshPromises.filter((p) => p.status === 'broken')).toEqual([
      expect.objectContaining({ amount: 3000, day: 'last_friday' }),
    ]);
    expect(sql).toContain(
      "(d.today - ((extract(isodow from d.today)::int + 1) % 7 + 1)), 'broken'",
    );
  });

  it('makes Ramesh the live shopkeeper for the phone page', () => {
    expect(sql).toContain(
      `insert into public.demo_settings (id, live_shopkeeper_id) values (1, '${shopkeeperId(0)}')`,
    );
  });

  it('uses only fake phone numbers and no real Indian mobile number anywhere', () => {
    expect(data.shopkeepers.every((s, i) => s.phone === fakePhone(i))).toBe(true);
    expect(data.shopkeepers.every((s) => /^\+91 00000 \d{5}$/.test(s.phone))).toBe(true);
    expect(sql).not.toMatch(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
  });

  it('keeps at most one open promise per shopkeeper', () => {
    for (const shopkeeper of data.shopkeepers) {
      const open = data.promises.filter(
        (p) => p.shopkeeperId === shopkeeper.id && p.status === 'open',
      );
      expect(open.length).toBeLessThanOrEqual(1);
    }
  });

  it('gives risky shopkeepers long overdue balances and reliable ones short ones', () => {
    const daysOverdue = (profile: string): number[] =>
      data.shopkeepers
        .filter((s) => s.profile === profile)
        .map((s) => computeDues(toLedger(entriesOf(s.id)), TODAY).daysOverdue);
    expect(daysOverdue('risky').filter((days) => days >= 30).length).toBeGreaterThanOrEqual(10);
    expect(daysOverdue('reliable').every((days) => days <= 15)).toBe(true);
  });

  it('includes payment claims waiting for the owner and one he rejected', () => {
    const claimed = data.entries.filter((entry) => entry.status === 'claimed');
    expect(claimed).toHaveLength(3);
    expect(data.entries.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    for (const claim of claimed)
      expect(outstandingOf(data.entries, claim.shopkeeperId)).toBeGreaterThan(0);
  });

  it('writes day offsets as SQL date arithmetic', () => {
    expect([dayExpression(0), dayExpression(-12), dayExpression(3)]).toEqual([
      'd.today',
      'd.today - 12',
      'd.today + 3',
    ]);
  });
});

describe('seeded random numbers', () => {
  it('repeats for the same seed and stays in range', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const draws = Array.from({ length: 50 }, () => a.int(1, 6));
    expect(Array.from({ length: 50 }, () => b.int(1, 6))).toEqual(draws);
    expect(draws.every((n) => n >= 1 && n <= 6)).toBe(true);
  });

  it('refuses to pick from an empty list', () => {
    expect(() => createRandom(1).pick([])).toThrow('at least one item');
  });
});
