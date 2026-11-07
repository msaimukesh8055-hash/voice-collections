// supabase/functions/_shared/followup/rules.test.ts
// Follow-up rules (M5 Decision 4): every row of the table, and the agent only on mixed signals.
import { assertEquals } from '@std/assert';
import { CLAIM, facts, PROMISE } from './__fixtures__/facts.ts';
import { decideByRules, findMixedSignals, outcomeFrom, outcomeOf } from './rules.ts';

const WANTS_OWNER = {
  reason: 'wants_owner',
  summary: 'Wants to talk about the last bill.',
} as const;
const HARDSHIP = { reason: 'hardship', summary: 'Shop closed for two weeks, illness.' } as const;
const DISPUTE = { reason: 'dispute', summary: 'Says the 5,000 credit was 4,000.' } as const;

Deno.test('rules › promise logged → check on the promise date', () => {
  assertEquals(decideByRules(facts({ promise: PROMISE })), {
    kind: 'rule',
    step: { kind: 'check_promise', date: '2026-11-09' },
  });
});

Deno.test('rules › claim recorded → ask the owner to confirm (even with a promise too)', () => {
  assertEquals(decideByRules(facts({ claim: CLAIM })), {
    kind: 'rule',
    step: { kind: 'confirm_claim' },
  });
  assertEquals(decideByRules(facts({ claim: CLAIM, promise: PROMISE })).kind, 'rule');
});

Deno.test('rules › owner callback asked → "please call" with Asha\'s reason', () => {
  assertEquals(decideByRules(facts({ callbacks: [WANTS_OWNER] })), {
    kind: 'rule',
    step: { kind: 'owner_callback', reason: 'Wants to talk about the last bill.' },
  });
});

Deno.test('rules › a dispute without a promise is a plain owner callback', () => {
  assertEquals(decideByRules(facts({ callbacks: [DISPUTE] })).kind, 'rule');
});

Deno.test('rules › declined or not answered → try again', () => {
  for (const declined of [true, false]) {
    const result = decideByRules(facts({ connected: false, declined, transcript: null }));
    assertEquals(result, { kind: 'rule', step: { kind: 'try_again' } });
  }
});

Deno.test('rules › ended before identity was confirmed → try again', () => {
  assertEquals(decideByRules(facts({ identity: 'unknown' })), {
    kind: 'rule',
    step: { kind: 'try_again' },
  });
});

Deno.test('rules › someone else asked the owner to call back before identity → owner callback', () => {
  assertEquals(
    decideByRules(facts({ identity: 'unknown', callbacks: [WANTS_OWNER] })).kind,
    'rule',
  );
});

Deno.test('rules › wrong person → nothing shared, even if they asked for a callback', () => {
  for (const callbacks of [[], [WANTS_OWNER]]) {
    assertEquals(decideByRules(facts({ identity: 'denied', callbacks })), {
      kind: 'rule',
      step: { kind: 'nothing_shared' },
    });
  }
});

Deno.test('rules › mixed signals go to the agent', () => {
  const cases = [
    { input: facts(), signals: ['no_promise'] },
    { input: facts({ callbacks: [HARDSHIP] }), signals: ['hardship'] },
    { input: facts({ promise: PROMISE, callbacks: [DISPUTE] }), signals: ['dispute_with_promise'] },
  ] as const;
  for (const { input, signals } of cases) {
    assertEquals(decideByRules(input), { kind: 'agent', signals });
  }
});

Deno.test('signals › an angry call is spotted in what the shopkeeper said, not what Asha said', () => {
  const angry = facts({
    promise: PROMISE,
    transcript: [
      { role: 'assistant', content: 'Sorry to disturb you.' },
      { role: 'user', content: 'Stop calling me every day!' },
    ],
  });
  assertEquals(findMixedSignals(angry), ['angry']);
  const polite = facts({
    promise: PROMISE,
    transcript: [{ role: 'assistant', content: 'I will stop calling now, please do not call us.' }],
  });
  assertEquals(findMixedSignals(polite), []);
});

Deno.test('signals › Hindi and Telugu "stop calling" phrases count too', () => {
  for (const content of ['Baar baar call mat karo', 'फोन मत करो', 'మళ్ళీ ఫోన్ చేయకండి']) {
    const input = facts({ promise: PROMISE, transcript: [{ role: 'user', content }] });
    assertEquals(findMixedSignals(input), ['angry']);
  }
});

Deno.test('signals › no transcript means no anger signal', () => {
  assertEquals(findMixedSignals(facts({ promise: PROMISE, transcript: null })), []);
});

Deno.test('outcome › one label per call result', () => {
  assertEquals(outcomeOf(facts({ connected: false, declined: true })), 'declined');
  assertEquals(outcomeOf(facts({ connected: false })), 'no_answer');
  assertEquals(outcomeOf(facts({ identity: 'denied' })), 'wrong_person');
  assertEquals(outcomeOf(facts({ identity: 'unknown' })), 'ended_early');
  assertEquals(outcomeOf(facts({ claim: CLAIM, promise: PROMISE })), 'claim');
  assertEquals(outcomeOf(facts({ promise: PROMISE })), 'promise');
  assertEquals(outcomeOf(facts({ callbacks: [WANTS_OWNER] })), 'callback');
  assertEquals(outcomeOf(facts()), 'no_promise');
  assertEquals(outcomeOf(facts({ identity: 'unknown', callbacks: [WANTS_OWNER] })), 'callback');
});

Deno.test('outcome › outcomeFrom labels plain flags the same way (call history, M7 B1)', () => {
  const base = {
    connected: true,
    declined: false,
    identity: 'confirmed',
    hasClaim: false,
    hasPromise: false,
    callbackCount: 0,
  } as const;
  assertEquals(outcomeFrom({ ...base, connected: false, declined: true }), 'declined');
  assertEquals(outcomeFrom({ ...base, connected: false }), 'no_answer');
  assertEquals(outcomeFrom({ ...base, identity: 'denied', callbackCount: 1 }), 'wrong_person');
  assertEquals(outcomeFrom({ ...base, identity: 'unknown' }), 'ended_early');
  assertEquals(outcomeFrom({ ...base, identity: 'unknown', callbackCount: 1 }), 'callback');
  assertEquals(outcomeFrom({ ...base, hasClaim: true, hasPromise: true }), 'claim');
  assertEquals(outcomeFrom({ ...base, hasPromise: true }), 'promise');
  assertEquals(outcomeFrom({ ...base, callbackCount: 2 }), 'callback');
  assertEquals(outcomeFrom(base), 'no_promise');
});
