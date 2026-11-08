// evals/munshi/scenario-checks.test.ts
// Outcome checks (critical: exactly the expected book changes) and flow checks (which tool, how
// often, asking which, what he said after) on hand-built runs.
import { describe, expect, it } from 'vitest';
import { LATHA_CLAIM_ID, RAMESH, RAMESH_CLAIM_ID } from './book.fixture.ts';
import { asksWhich, passesOnNote, saysAfter, toolGave, usesTool } from './flow-checks.ts';
import { outcomeChecks } from './outcome-checks.ts';
import {
  called,
  EMPTY_BOOK,
  munshi,
  owner,
  refused,
  runOf,
  tool,
  withEntry,
} from './__fixtures__/runs.ts';
import type { EvalRun, ExpectedOutcome } from './types.ts';

function failures(outcome: ExpectedOutcome, run: EvalRun): readonly string[] {
  return outcomeChecks(outcome).flatMap((check) => (check.test(run) === null ? [] : [check.id]));
}

const SEND_ID = 'a0000000-0000-4000-8000-000000000001';

describe('outcome checks', () => {
  it('nothing expected and nothing changed → all pass', () => {
    expect(failures({}, runOf({ events: [] }))).toEqual([]);
  });

  it('the expected entry, with or without its due date', () => {
    const after = withEntry({
      shopkeeperId: RAMESH.id,
      kind: 'credit',
      amount: 3000,
      dueDate: '2026-11-22',
    });
    const run = runOf({ events: [], after });
    expect(
      failures({ entries: [{ shopkeeperId: RAMESH.id, kind: 'credit', amount: 3000 }] }, run),
    ).toEqual([]);
    const wrongDue = {
      entries: [
        { shopkeeperId: RAMESH.id, kind: 'credit' as const, amount: 3000, dueDate: '2026-11-15' },
      ],
    };
    expect(failures(wrongDue, run)).toEqual(['outcome_entries']);
    expect(failures({}, run)).toEqual(['outcome_entries']);
  });

  it('reversals and reminders must match exactly', () => {
    const run = runOf({ events: [], after: { reversals: ['e1'], queued: [RAMESH.id] } });
    expect(failures({ reversed: ['e1'], reminders: [RAMESH.id] }, run)).toEqual([]);
    expect(failures({ reversed: ['e2'] }, run)).toEqual(['outcome_reversed', 'outcome_reminders']);
  });

  it('claims: the expected ones settled as expected, the rest still open', () => {
    const settled = EMPTY_BOOK.entries.map((entry) => {
      if (entry.id === LATHA_CLAIM_ID) return { ...entry, status: 'confirmed' as const };
      if (entry.id === RAMESH_CLAIM_ID) return { ...entry, status: 'rejected' as const };
      return entry;
    });
    const run = runOf({ events: [], after: { entries: settled } });
    expect(
      failures({ claims: { [LATHA_CLAIM_ID]: 'confirmed', [RAMESH_CLAIM_ID]: 'rejected' } }, run),
    ).toEqual([]);
    expect(failures({ claims: { [LATHA_CLAIM_ID]: 'confirmed' } }, run)).toEqual([
      'outcome_claims',
    ]);
  });

  it('sends are read from the kicked voice action', () => {
    const action = {
      id: SEND_ID,
      ownerId: 'o',
      ownerCallId: 'c',
      kind: 'voice_send' as const,
      ref: 'r1',
      data: { what: 'pending', shopkeeperId: null, name: null },
      status: 'saved' as const,
      createdAt: '2026-11-07T06:30:00.000Z',
      expiresAt: '2026-11-07T06:33:00.000Z',
    };
    const run = runOf({ events: [], after: { kicked: [SEND_ID], actions: [action] } });
    expect(failures({ sends: ['pending'] }, run)).toEqual([]);
    const unknown = runOf({ events: [], after: { kicked: ['missing'] } });
    expect(outcomeChecks({ sends: ['pending'] })[4]?.test(unknown)).toContain('unknown');
  });
});

describe('flow checks', () => {
  const overview = called('book_summary', { focus: 'overview' });

  it('usesTool: arguments compared as text, exact count when given', () => {
    const run = runOf({ events: [overview, called('prepare_payment', { amount: '2000' })] });
    expect(
      usesTool('book_summary', { args: { focus: 'OVERVIEW' }, count: 1 }).test(run),
    ).toBeNull();
    expect(usesTool('prepare_payment', { args: { amount: 2000 } }).test(run)).toBeNull();
    expect(usesTool('book_summary', { count: 2 }).test(run)).toContain('called 1 times');
    expect(usesTool('cancel_action').test(run)).toContain('called 0 times');
  });

  it('asksWhich: choices, then no figure until he picks', () => {
    const choices = tool('lookup_shopkeeper', 'More than one shopkeeper fits.', {
      choice_count: 2,
    });
    const good = runOf({
      events: [
        owner('Suresh?'),
        choices,
        munshi('Which Suresh?'),
        owner('Tea stall.'),
        munshi('750.'),
      ],
    });
    expect(asksWhich('lookup_shopkeeper').test(good)).toBeNull();
    const early = runOf({ events: [owner('Suresh?'), choices, munshi('One owes 3,200.')] });
    expect(asksWhich('lookup_shopkeeper').test(early)).toBe('said a figure before he picked one');
    const guess = runOf({
      events: [owner('Suresh?'), tool('lookup_shopkeeper', 'Suresh: 750.', { outstanding: 750 })],
    });
    expect(asksWhich('lookup_shopkeeper').test(guess)).toContain('never offered choices');
  });

  it('toolGave: a successful reply with that value', () => {
    const run = runOf({
      events: [
        refused('lookup_shopkeeper', 'NOT_FOUND'),
        tool('lookup_shopkeeper', 's', { outstanding: 750 }),
      ],
    });
    expect(toolGave('lookup_shopkeeper', 'outstanding', 750).test(run)).toBeNull();
    expect(toolGave('lookup_shopkeeper', 'outstanding', 3200).test(run)).toContain(
      'no lookup_shopkeeper reply',
    );
  });

  it('saysAfter: a matching line after the last successful tool', () => {
    const check = saysAfter('confirm_action', /whatsapp/i, 'recaps_whatsapp');
    const run = runOf({
      events: [
        tool('confirm_action', 'Sending now.'),
        munshi('Coming on WhatsApp. Anything else?'),
      ],
    });
    expect(check.test(run)).toBeNull();
    expect(
      check.test(runOf({ events: [tool('confirm_action', 'ok'), munshi('Done.')] })),
    ).toContain('nothing matching');
    expect(check.test(runOf({ events: [refused('confirm_action', 'TOO_SOON')] }))).toBe(
      'no successful confirm_action',
    );
  });

  it('passesOnNote: the note reached him', () => {
    const check = passesOnNote('Time is nearly up', /time/i, 'mentions_time_up');
    const noted = tool('book_summary', 'Due today: 2 people. Time is nearly up on this call.');
    expect(check.test(runOf({ events: [noted, munshi('We are almost out of time.')] }))).toBeNull();
    expect(check.test(runOf({ events: [noted, munshi('Two people.')] }))).toBe('never told him');
    expect(check.test(runOf({ events: [overview] }))).toBe('no tool reply carried the note');
  });
});
