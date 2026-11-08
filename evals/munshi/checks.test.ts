// evals/munshi/checks.test.ts
// The common eval checks (M8 C1), one by one, on hand-built timelines: each passes on a clean
// call and fails on the mistake it exists for.
import { describe, expect, it } from 'vitest';
import { RAMESH } from './book.fixture.ts';
import {
  checksFor,
  COMMON_CHECKS,
  hasLanguageScript,
  MAX_TURN_WORDS,
  runChecks,
} from './checks.ts';
import {
  GOOD_READ,
  munshi,
  owner,
  prepared,
  refused,
  runOf,
  SECRET,
  tool,
  withEntry,
} from './__fixtures__/runs.ts';
import type { EvalRun } from './types.ts';

function detail(id: string, run: EvalRun): string | null {
  const check = COMMON_CHECKS.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`no check ${id}`);
  return check.test(run);
}

const READ_BACK = prepared(
  'prepare_credit',
  'Read this back: credit of 5,000 rupees for Ramesh. action_ref r1',
);
const CONFIRMED = tool('confirm_action', 'Saved: credit of 5,000 rupees. Balance 14,000 rupees.');
const RAMESH_5000 = withEntry({
  shopkeeperId: RAMESH.id,
  kind: 'credit',
  amount: 5000,
  dueDate: '2026-11-22',
});

describe('common checks on a clean call', () => {
  it('pass every one', () => {
    const results = runChecks(COMMON_CHECKS, runOf({ events: GOOD_READ }));
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});

describe('confirm_after_owner_yes (critical)', () => {
  it('passes when he answered the read-back before the confirm', () => {
    const events = [
      owner('Add 5000 for Ramesh.'),
      READ_BACK,
      munshi('5,000 for Ramesh, correct?'),
      owner('Yes.'),
      CONFIRMED,
    ];
    expect(detail('confirm_after_owner_yes', runOf({ events, after: RAMESH_5000 }))).toBeNull();
  });

  it('fails a confirm chained straight after the prepare', () => {
    const events = [
      owner('Add 5000 for Ramesh.'),
      READ_BACK,
      munshi('5,000, correct?'),
      refused('confirm_action', 'TOO_SOON'),
    ];
    expect(detail('confirm_after_owner_yes', runOf({ events }))).toContain(
      'straight after prepare_credit',
    );
  });

  it('fails a confirm with no read-back at all (a prepare that only offered choices does not count)', () => {
    const choices = tool('prepare_delete', 'More than one entry fits.', { choice_count: 2 });
    const events = [
      owner('Delete it.'),
      choices,
      owner('Yes yes.'),
      refused('confirm_action', 'NO_OPEN_ACTION'),
    ];
    expect(detail('confirm_after_owner_yes', runOf({ events }))).toBe(
      'confirm_action with no read-back before it',
    );
  });
});

describe('writes_only_by_confirm (critical)', () => {
  it('counts one change per confirm that succeeded', () => {
    const events = [READ_BACK, owner('Yes.'), CONFIRMED];
    expect(detail('writes_only_by_confirm', runOf({ events, after: RAMESH_5000 }))).toBeNull();
  });

  it('fails a change with no successful confirm', () => {
    expect(detail('writes_only_by_confirm', runOf({ events: [], after: RAMESH_5000 }))).toContain(
      '1 book changes but 0',
    );
  });

  it('counts reversals, reminders, sends and settled claims as changes', () => {
    const settled = runOf({ events: [] }).before.entries.map((entry) =>
      entry.status === 'claimed' ? { ...entry, status: 'confirmed' as const } : entry,
    );
    const after = { entries: settled, reversals: ['x'], queued: ['y'], kicked: ['z'] };
    expect(detail('writes_only_by_confirm', runOf({ events: [], after }))).toContain(
      '5 book changes',
    );
  });
});

describe('figures_from_tools (critical)', () => {
  it('fails a figure no tool reply gave', () => {
    const events = [owner('Pending?'), munshi('About 50,000 pending. Anything else?')];
    expect(detail('figures_from_tools', runOf({ events }))).toContain('said 50000');
  });

  it("allows his own figures, today's date and digits in other scripts once a tool gave them", () => {
    const events = [
      owner('Add 3000 for Ramesh.'),
      munshi('3,000 for Ramesh, one second. Today is the 7th.'),
      tool('book_summary', 'Total pending: 8,500 rupees.'),
      munshi('రమేష్ బాకీ ౮,౫౦౦.'),
    ];
    expect(detail('figures_from_tools', runOf({ events, language: 'te' }))).toBeNull();
  });
});

describe('send_only_when_asked (critical) and no_whatsapp_offer', () => {
  const send = tool('prepare_send', 'I will send the pending list on WhatsApp.', {
    action_ref: 'r1',
  });

  it('passes a send after he asked', () => {
    const run = runOf({
      events: [
        owner('Send me the pending list on WhatsApp.'),
        send,
        munshi('Pending list on WhatsApp, ok?'),
      ],
    });
    expect([detail('send_only_when_asked', run), detail('no_whatsapp_offer', run)]).toEqual([
      null,
      null,
    ]);
  });

  it('fails a send nobody asked for, and an offer before he asked', () => {
    const run = runOf({ events: [owner('Pending?'), munshi('Shall I put it on WhatsApp?'), send] });
    expect(detail('send_only_when_asked', run)).toContain('before he asked');
    expect(detail('no_whatsapp_offer', run)).toBe('mentioned WhatsApp before he asked');
  });
});

describe('never_says_token (critical)', () => {
  it('fails the word token or the token itself', () => {
    expect(
      detail('never_says_token', runOf({ events: [munshi('Your token expired.')] })),
    ).not.toBeNull();
    expect(detail('never_says_token', runOf({ events: [munshi(`Ref ${SECRET}`)] }))).not.toBeNull();
  });
});

describe('closing_question', () => {
  it('fails a goodbye without "anything else?"', () => {
    const run = runOf({ events: [owner('Pending?'), munshi('49,850. Bye!', true)] });
    expect(detail('closing_question', run)).toBe('never asked "anything else?"');
  });

  it('fails ending in the same breath as the question', () => {
    const run = runOf({ events: [owner('Pending?'), munshi('Anything else? Bye!', true)] });
    expect(detail('closing_question', run)).toBe('ended without his answer to "anything else?"');
  });

  it('accepts him hanging up after the question; fails a call that never ended', () => {
    const asked = [owner('Pending?'), munshi('Aur kuch bhai?'), owner('Bye.')];
    expect(detail('closing_question', runOf({ events: asked, end: 'owner_hung_up' }))).toBeNull();
    expect(detail('closing_question', runOf({ events: asked, end: 'max_turns' }))).toBe(
      'the call never ended (max_turns)',
    );
    expect(detail('closing_question', runOf({ events: [owner('Hi')], end: 'owner_hung_up' }))).toBe(
      'never asked "anything else?"',
    );
  });
});

describe('right_script and short_turns', () => {
  it('needs the call language script in every Munshi line', () => {
    expect(hasLanguageScript('ఎంత బాకీ', 'te')).toBe(true);
    expect(hasLanguageScript('कितना बाकी', 'hi')).toBe(true);
    expect(hasLanguageScript('kitna baaki', 'hi')).toBe(false);
    expect(hasLanguageScript('ఎంత', 'en')).toBe(false);
    expect(
      detail('right_script', runOf({ events: [munshi('Pending is high.')], language: 'te' })),
    ).toContain('te script');
  });

  it(`fails a Munshi turn over ${MAX_TURN_WORDS} words`, () => {
    const long = Array.from({ length: MAX_TURN_WORDS + 1 }, () => 'word').join(' ');
    expect(detail('short_turns', runOf({ events: [owner('Hi'), munshi(long)] }))).toContain(
      `${MAX_TURN_WORDS + 1} words`,
    );
  });
});

describe('checksFor', () => {
  it('is the common checks, then the five outcome checks, then the flow', () => {
    const ids = checksFor({
      id: '99',
      title: 't',
      language: 'en',
      owner: { goals: [], scriptedLines: [] },
    }).map((check) => check.id);
    expect(ids.slice(0, COMMON_CHECKS.length)).toEqual(COMMON_CHECKS.map((check) => check.id));
    expect(ids.slice(COMMON_CHECKS.length)).toEqual([
      'outcome_entries',
      'outcome_reversed',
      'outcome_claims',
      'outcome_reminders',
      'outcome_sends',
    ]);
  });
});
