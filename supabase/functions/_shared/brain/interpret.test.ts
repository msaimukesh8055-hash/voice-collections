// supabase/functions/_shared/brain/interpret.test.ts
import { assertEquals } from '@std/assert';
import { interpret } from './interpret.ts';
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
