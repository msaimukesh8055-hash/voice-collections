// supabase/functions/_shared/brain/interpret.test.ts
import { assertEquals } from '@std/assert';
import type { Command } from './commands.ts';
import { interpret, notAPromise } from './interpret.ts';
import type { BrainLlm, LlmResult } from './llm.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');

function deps(result: LlmResult, calls: string[] = []): Parameters<typeof interpret>[1] {
  const llm: BrainLlm = (message) => {
    calls.push(message);
    return Promise.resolve(result);
  };
  return { today: '2026-11-02', now: NOW, llm, isKnownName: (name) => name === 'Ramesh' };
}

const FAILED: LlmResult = { suggestion: null, path: 'failed' };

Deno.test('interpret › a fixed command never calls the LLM', async () => {
  const calls: string[] = [];
  const result = await interpret('Ramesh paid 2000', deps(FAILED, calls));
  assertEquals(result, {
    command: { kind: 'mark_paid', name: 'Ramesh', amount: 2000 },
    path: 'command',
    language: 'en',
  });
  assertEquals(calls, []);
});

Deno.test('interpret › a known name is a lookup; an unknown word goes to the LLM', async () => {
  assertEquals((await interpret('ramesh', deps(FAILED))).path, 'command');
  const calls: string[] = [];
  const result = await interpret(
    'thanks',
    deps({ suggestion: { intent: 'unknown' }, path: 'sarvam' }, calls),
  );
  assertEquals(result, { command: null, path: 'sarvam', language: 'en' });
  assertEquals(calls, ['thanks']);
});

Deno.test('interpret › Telugu script goes to the LLM; its suggestion becomes a command', async () => {
  const suggestion = { intent: 'mark_paid', name: 'Ramesh', amount: 2000 } as const;
  const result = await interpret('రమేష్ 2000 కట్టాడు', deps({ suggestion, path: 'gemini' }));
  assertEquals(result, {
    command: { kind: 'mark_paid', name: 'Ramesh', amount: 2000 },
    path: 'gemini',
    language: 'te',
  });
});

Deno.test('interpret › both LLMs failing leaves no command', async () => {
  assertEquals(await interpret('क्या हाल है', deps(FAILED)), {
    command: null,
    path: 'failed',
    language: 'hi',
  });
});

Deno.test('interpret › remind and score need a known name, else the LLM reads it (M5)', async () => {
  assertEquals((await interpret('remind Ramesh', deps(FAILED))).command, {
    kind: 'remind',
    name: 'Ramesh',
  });
  assertEquals((await interpret('Ramesh score', deps(FAILED))).path, 'command');
  const calls: string[] = [];
  const result = await interpret('remind me tomorrow', deps(FAILED, calls));
  assertEquals([result.command, calls.length], [null, 1]);
  assertEquals((await interpret('remind all', deps(FAILED))).command, { kind: 'remind_all' });
});

/** Dry-run fix 3: the live voice note, as Saaras' translit mode and as Devanagari text. */
const SALIM_PAID = [
  'Salim ne 1,000 rupaye diye',
  'Salim ne 1,000 rupaye diye.',
  'Salim ne 1000 rupaye diye',
  'salim ne 1,000 diye',
  'Salim ne ₹1,000 diye',
  'Salim ne 1,000 rupaye de diye',
  'सलीम ने 1,000 रुपये दिए',
  'सलीम ने 1,000 रुपए दिए।',
  'सलीम ने १,००० रुपये दिये',
  'सलीम ने ₹1000 दिए',
  'Salim ने 1,000 रुपये दिए',
];

function knowsSalim(result: LlmResult, calls: string[] = []): Parameters<typeof interpret>[1] {
  return { ...deps(result, calls), isKnownName: (name) => name === 'Salim' };
}

Deno.test('interpret › "Salim ne 1,000 rupaye diye" is a payment of exactly 1000, no LLM', async () => {
  for (const text of SALIM_PAID) {
    const calls: string[] = [];
    const result = await interpret(text, knowsSalim(FAILED, calls));
    assertEquals(result.command, { kind: 'mark_paid', name: 'Salim', amount: 1000 }, text);
    assertEquals([result.path, calls.length], ['command', 0], text);
  }
});

Deno.test('interpret › a Devanagari name that is not a shopkeeper goes to the LLM', async () => {
  const calls: string[] = [];
  const result = await interpret('मोहन ने 500 रुपये दिए', knowsSalim(FAILED, calls));
  assertEquals([result.command, calls.length], [null, 1]);
});

Deno.test('interpret › the LLM can never turn a written "1,000" into 10,000', async () => {
  const wrong = {
    intent: 'add_credit',
    name: 'Salim',
    amount: 10000,
    note: 'Given today',
  } as const;
  const result = await interpret(
    'सलीम को 1,000 का माल',
    knowsSalim({ suggestion: wrong, path: 'sarvam' }),
  );
  assertEquals(result.command, null);
  const right = { intent: 'mark_paid', name: 'Salim', amount: 1000 } as const;
  const kept = await interpret(
    'सलीम से 1,000 मिले',
    knowsSalim({ suggestion: right, path: 'sarvam' }),
  );
  assertEquals(kept.command, { kind: 'mark_paid', name: 'Salim', amount: 1000 });
});

Deno.test('interpret › with no figures written, the LLM amount stands ("ek hazaar")', async () => {
  const suggestion = { intent: 'mark_paid', name: 'Salim', amount: 1000 } as const;
  const result = await interpret(
    'Salim ne ek hazaar rupaye diye',
    knowsSalim({ suggestion, path: 'sarvam' }),
  );
  assertEquals(result.command, { kind: 'mark_paid', name: 'Salim', amount: 1000 });
});

Deno.test('interpret › "call Ramesh now" is a call request; an unknown name goes to the LLM', async () => {
  for (const text of ['call Ramesh', 'Call Ramesh now', 'Please call Ramesh and remind him']) {
    const result = await interpret(text, deps(FAILED));
    assertEquals(result.command, { kind: 'call_request', name: 'Ramesh' }, text);
  }
  const suggestion = { intent: 'call', name: 'Ramesh' } as const;
  const calls: string[] = [];
  const hindi = await interpret(
    'Ramesh ko yaad dilao',
    deps({ suggestion, path: 'sarvam' }, calls),
  );
  assertEquals([hindi.command, calls.length], [{ kind: 'call_request', name: 'Ramesh' }, 1]);
  const unknown = await interpret('call Mohan', deps(FAILED));
  assertEquals(unknown.path, 'failed');
});

Deno.test('interpret › a promise to pay never becomes a money card, whatever the model says (M9)', () => {
  const credit: Command = {
    kind: 'add_credit',
    name: 'Ramesh',
    amount: 5000,
    dueDate: '2026-11-15',
    note: null,
  };
  const paid: Command = { kind: 'mark_paid', name: 'Ramesh', amount: 5000 };
  assertEquals(notAPromise(credit, 'Ramesh will pay 5000 by 15th'), null);
  assertEquals(notAPromise(paid, 'Ramesh will pay 5000 by 15th'), null);
  // A real credit with a due date, and commands that move no money, are left alone.
  assertEquals(notAPromise(credit, 'Ramesh will pay 5000 by 15th credit ichchaanu'), credit);
  assertEquals(notAPromise({ kind: 'pending' }, 'who will pay this week'), { kind: 'pending' });
  assertEquals(notAPromise(null, 'Ramesh will pay 5000 by 15th'), null);
});
