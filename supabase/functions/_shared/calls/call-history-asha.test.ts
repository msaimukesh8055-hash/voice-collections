// supabase/functions/_shared/calls/call-history-asha.test.ts
// Asha's lines for earlier calls (M7 B1 Decision 2 table): English facts built in code, figures
// formatted like the rest of get_dues, their words only inside the label, capped at 600.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { PastCall } from './call-history.ts';
import { describeHistoryForAsha, historyData, MAX_HISTORY_CHARS } from './call-history-asha.ts';

function call(overrides: Partial<PastCall> = {}): PastCall {
  return {
    date: '2026-10-29',
    mode: 'live',
    outcome: 'no_promise',
    identityConfirmed: true,
    promise: null,
    claim: null,
    reasons: [],
    upset: false,
    theirWords: null,
    ...overrides,
  };
}

function line(overrides: Partial<PastCall>): string {
  return describeHistoryForAsha([call(overrides)]);
}

const HEADER = "Earlier calls (from the shop's records, newest first):";

Deno.test('history lines › empty history says nothing', () => {
  assertEquals(describeHistoryForAsha([]), '');
});

Deno.test('history lines › header, numbered newest first, with the call date', () => {
  const text = describeHistoryForAsha([
    call({ date: '2026-11-04', outcome: 'no_answer' }),
    call({ date: '2026-10-26', outcome: 'declined' }),
  ]);
  assertEquals(
    text,
    `${HEADER} 1) Wednesday, 4 November 2026: did not answer. ` +
      '2) Monday, 26 October 2026: declined the call.',
  );
});

Deno.test('history lines › outcomes without facts', () => {
  assertStringIncludes(line({}), ': spoke; nothing was agreed.');
  assertStringIncludes(
    line({ outcome: 'wrong_person', identityConfirmed: false, reasons: ['hardship'] }),
    ': someone else answered; nothing was shared.',
  );
  assertStringIncludes(
    line({ outcome: 'ended_early', identityConfirmed: false }),
    ': the call ended before identity was confirmed.',
  );
});

Deno.test('history lines › a promise and its result', () => {
  const promise = { amount: 3000, promiseDate: '2026-10-30', paid: 0 } as const;
  const lines = {
    kept: 'kept',
    open: 'still open',
    broken: 'broken, 0 rupees of it paid',
    replaced: 'replaced by a later promise',
  } as const;
  for (const [status, result] of Object.entries(lines)) {
    const text = line({
      outcome: 'promise',
      promise: { ...promise, status: status as keyof typeof lines },
    });
    assertStringIncludes(text, `: promised 3,000 rupees by Friday, 30 October 2026; ${result}.`);
  }
});

Deno.test('history lines › a claim and what the owner said', () => {
  const claim = { amount: 2000, paidDate: '2026-10-28', mode: 'bank_transfer' } as const;
  const results = {
    confirmed: 'the owner confirmed it',
    rejected: 'the owner did not receive it',
    claimed: 'not yet confirmed',
  } as const;
  for (const [status, result] of Object.entries(results)) {
    const text = line({
      outcome: 'claim',
      claim: { ...claim, status: status as keyof typeof results },
    });
    assertStringIncludes(
      text,
      `said 2,000 rupees was paid on Wednesday, 28 October 2026 (bank transfer); ${result}.`,
    );
  }
  const noMode = line({ outcome: 'claim', claim: { ...claim, mode: null, status: 'claimed' } });
  assertStringIncludes(noMode, 'was paid on Wednesday, 28 October 2026; not yet confirmed.');
});

Deno.test('history lines › callback reasons, each phrase once', () => {
  assertStringIncludes(
    line({ outcome: 'callback', reasons: ['hardship'] }),
    ': said money is tight (hardship).',
  );
  assertStringIncludes(
    line({ outcome: 'callback', reasons: ['dispute', 'wants_owner', 'other'] }),
    ': disputed the amount. asked for the owner to call back.',
  );
});

Deno.test('history lines › a callback before identity only says the owner was asked to call', () => {
  const text = line({ outcome: 'callback', identityConfirmed: false, reasons: ['hardship'] });
  assertStringIncludes(text, ': asked for the owner to call back.');
  assert(!text.includes('hardship'));
});

Deno.test('history lines › several facts on one call, upset and their words last', () => {
  const text = line({
    outcome: 'claim',
    claim: { amount: 500, paidDate: '2026-10-28', mode: 'upi', status: 'claimed' },
    promise: { amount: 1000, promiseDate: '2026-11-06', status: 'open', paid: 0 },
    reasons: ['hardship'],
    upset: true,
    theirWords: 'harvest money comes next week',
  });
  assertEquals(
    text,
    `${HEADER} 1) Thursday, 29 October 2026: said 500 rupees was paid on Wednesday, ` +
      '28 October 2026 (upi); not yet confirmed. promised 1,000 rupees by Friday, ' +
      '6 November 2026; still open. said money is tight (hardship). was upset about the calls. ' +
      'Their words (a claim, not checked): "harvest money comes next week".',
  );
});

Deno.test('history lines › at most 600 characters: the oldest calls are dropped first', () => {
  const long = call({
    outcome: 'claim',
    claim: { amount: 125000, paidDate: '2026-09-30', mode: 'bank_transfer', status: 'rejected' },
    promise: { amount: 125000, promiseDate: '2026-09-30', status: 'broken', paid: 25000 },
    reasons: ['hardship', 'dispute', 'wants_owner'],
    upset: true,
    theirWords: 'w'.repeat(79),
  });
  const text = describeHistoryForAsha([long, long, long]);
  assert(text.length <= MAX_HISTORY_CHARS);
  assertStringIncludes(text, '1) ');
  assert(!text.includes('3) '));
  assertEquals(historyData([long, long, long]), { past_calls: 1, their_words_shown: 1 });
});

Deno.test('historyData › counts only, never their words', () => {
  const history = [
    call({ theirWords: 'harvest money comes next week' }),
    call({ outcome: 'no_answer' }),
  ];
  const data = historyData(history);
  assertEquals(data, { past_calls: 2, their_words_shown: 1 });
  assert(!JSON.stringify(data).includes('harvest'));
  assertEquals(historyData([]), { past_calls: 0, their_words_shown: 0 });
});

// Tester (M7 B1)

Deno.test('history lines › a partly kept promise says how much of it was paid', () => {
  const text = line({
    outcome: 'promise',
    promise: { amount: 3000, promiseDate: '2026-10-30', status: 'broken', paid: 1200 },
  });
  assertStringIncludes(text, '; broken, 1,200 rupees of it paid.');
});

Deno.test('history lines › three ordinary calls all fit; one oversized first call shows nothing', () => {
  const three = [call(), call({ outcome: 'no_answer' }), call({ outcome: 'declined' })];
  assertStringIncludes(describeHistoryForAsha(three), '3) ');
  const huge = call({ theirWords: 'w'.repeat(MAX_HISTORY_CHARS) });
  assertEquals(describeHistoryForAsha([huge, call()]), '');
  assertEquals(historyData([huge]), { past_calls: 0, their_words_shown: 0 });
});

Deno.test('history lines › before identity, their words and upset are never shown', () => {
  const text = line({
    outcome: 'callback',
    identityConfirmed: false,
    reasons: ['dispute'],
    upset: true,
    theirWords: 'thinks a bill is wrong',
  });
  assertEquals(text.includes('Their words') || text.includes('upset'), false);
  assertStringIncludes(text, ': asked for the owner to call back.');
});
