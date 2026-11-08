// supabase/functions/_shared/calls/call-history-owner.test.ts
// Munshi's wording of Asha's past calls (M8 A5): facts from records only, the shopkeeper's words
// only inside their label, nothing past an unconfirmed identity, capped in length.
import { assert, assertEquals } from '@std/assert';
import type { PastCall, PastClaim, PastPromise } from './call-history.ts';
import { describeHistoryForOwner, MAX_OWNER_HISTORY_CHARS } from './call-history-owner.ts';

const HEADER = "Asha's calls (from the shop's records, newest first):";

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

function lineFor(past: PastCall): string {
  return describeHistoryForOwner([past]).slice(HEADER.length + 1);
}

Deno.test('owner history › no calls → nothing to say', () => {
  assertEquals(describeHistoryForOwner([]), '');
});

Deno.test('owner history › the header comes first', () => {
  assert(describeHistoryForOwner([call()]).startsWith(`${HEADER} `));
});

Deno.test('owner history › fixed outcomes say only that', () => {
  assertEquals(lineFor(call({ outcome: 'declined' })), 'Thu 29 Oct: he declined the call.');
  assertEquals(
    lineFor(call({ outcome: 'no_answer', mode: 'simulated' })),
    'Thu 29 Oct (text call): no answer.',
  );
  assertEquals(
    lineFor(call({ outcome: 'wrong_person', theirWords: 'secret' })),
    'Thu 29 Oct: someone else answered; nothing was shared.',
  );
  assertEquals(
    lineFor(call({ outcome: 'ended_early' })),
    'Thu 29 Oct: the call ended before he confirmed who he was.',
  );
});

Deno.test('owner history › before identity: only that the owner was asked to call', () => {
  const past = call({
    outcome: 'callback',
    identityConfirmed: false,
    reasons: ['dispute'],
    theirWords: 'I never took it',
  });
  assertEquals(lineFor(past), 'Thu 29 Oct: asked you to call back.');
});

Deno.test('owner history › promises with every result', () => {
  const base = { amount: 3000, promiseDate: '2026-10-30', paid: 1000 };
  const results: ReadonlyArray<readonly [PastPromise['status'], string]> = [
    ['kept', 'kept'],
    ['open', 'still open'],
    ['broken', 'broken, 1,000 rupees of it paid'],
    ['replaced', 'replaced by a later promise'],
  ];
  for (const [status, text] of results) {
    assertEquals(
      lineFor(call({ outcome: 'promise', promise: { ...base, status } })),
      `Thu 29 Oct: promised 3,000 rupees by Fri 30 Oct, ${text}.`,
    );
  }
});

Deno.test('owner history › claims with every result, mode in words', () => {
  const base = { amount: 2000, paidDate: '2026-10-28', mode: 'bank_transfer' } as const;
  const results: ReadonlyArray<readonly [PastClaim['status'], string]> = [
    ['confirmed', 'you confirmed it'],
    ['rejected', 'you marked it not received'],
    ['claimed', 'waiting for you to confirm'],
    ['reversed', 'you later deleted it'],
  ];
  for (const [status, text] of results) {
    assertEquals(
      lineFor(call({ outcome: 'claim', claim: { ...base, status } })),
      `Thu 29 Oct: said 2,000 rupees was paid on Wed 28 Oct by bank transfer, ${text}.`,
    );
  }
  const noMode = call({ outcome: 'claim', claim: { ...base, mode: null, status: 'claimed' } });
  assertEquals(
    lineFor(noMode),
    'Thu 29 Oct: said 2,000 rupees was paid on Wed 28 Oct, waiting for you to confirm.',
  );
});

Deno.test('owner history › reasons (deduplicated), upset, their words in their label', () => {
  const past = call({
    outcome: 'callback',
    reasons: ['hardship', 'wants_owner', 'other', 'dispute'],
    upset: true,
    theirWords: 'harvest money comes next week',
  });
  assertEquals(
    lineFor(past),
    'Thu 29 Oct: said money is tight; asked you to call back; disputed the amount; was upset ' +
      'about the calls; Their words (a claim, not checked): "harvest money comes next week".',
  );
});

Deno.test('owner history › nothing agreed', () => {
  assertEquals(lineFor(call()), 'Thu 29 Oct: spoke; nothing was agreed.');
});

Deno.test('owner history › capped: newest calls kept, older ones dropped', () => {
  const words = 'w'.repeat(150);
  const history = [
    call({ date: '2026-10-29', outcome: 'callback', reasons: ['other'], theirWords: words }),
    call({ date: '2026-10-20', outcome: 'callback', reasons: ['other'], theirWords: words }),
    call({ date: '2026-10-10', outcome: 'declined' }),
  ];
  const said = describeHistoryForOwner(history);
  assert(said.length <= MAX_OWNER_HISTORY_CHARS);
  assert(said.includes('Thu 29 Oct'));
  assert(!said.includes('Sat 10 Oct'));
  const tooLong = call({ theirWords: 'x'.repeat(MAX_OWNER_HISTORY_CHARS) });
  assertEquals(describeHistoryForOwner([tooLong]), '');
});
