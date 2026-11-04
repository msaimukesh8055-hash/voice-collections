// supabase/functions/_shared/brain/prompt.test.ts
import { assert, assertEquals } from '@std/assert';
import { BRAIN_PROMPT_VERSION, buildBrainPrompt } from './prompt.ts';

const NOW = new Date('2026-11-04T06:00:00Z');

/** The four lines Saim approved on 2026-11-04, word for word. */
const V2_LINES = [
  '{"intent":"ledger_query","query":"due_alert"}  — who is due today or overdue',
  '{"intent":"ledger_query","query":"insights"}  — a report: how collections are going this month',
  '{"intent":"ledger_query","query":"dashboard"}  — he wants the web dashboard link',
  '{"intent":"ledger_query","query":"score","name":"<name>"}  — why a shopkeeper\'s score is what it is',
];

Deno.test('prompt › version is v2', () => {
  assertEquals(BRAIN_PROMPT_VERSION, 'v2');
});

Deno.test('prompt › has the four approved v2 lines right after the shopkeeper line', () => {
  const lines = buildBrainPrompt(NOW).split('\n');
  const shopkeeper = lines.findIndex((line) => line.includes('"query":"shopkeeper"'));
  assert(shopkeeper >= 0);
  assertEquals(lines.slice(shopkeeper + 1, shopkeeper + 5), V2_LINES);
});

Deno.test('prompt › never offers remind or remind_all to the LLM', () => {
  assert(!buildBrainPrompt(NOW).includes('remind'));
});
