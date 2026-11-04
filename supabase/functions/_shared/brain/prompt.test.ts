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

Deno.test('prompt › version is v3 (dry-run fixes)', () => {
  assertEquals(BRAIN_PROMPT_VERSION, 'v3');
});

Deno.test('prompt › has the four approved v2 lines right after the shopkeeper line', () => {
  const lines = buildBrainPrompt(NOW).split('\n');
  const shopkeeper = lines.findIndex((line) => line.includes('"query":"shopkeeper"'));
  assert(shopkeeper >= 0);
  assertEquals(lines.slice(shopkeeper + 1, shopkeeper + 5), V2_LINES);
});

Deno.test('prompt › never offers remind or remind_all; only "call", which shows a confirm card', () => {
  const prompt = buildBrainPrompt(NOW);
  assert(!prompt.includes('remind'));
  assert(prompt.includes('{"intent":"call","name":"<name>"}'));
});

Deno.test('prompt › v3 rules: real notes only, Hindi "ne … diye" is a payment, copy the amount', () => {
  const prompt = buildBrainPrompt(NOW);
  assert(prompt.includes('Never "given", "credit", "today" or "udhaar"'));
  assert(prompt.includes('"X ne N diye" / "X ne N rupaye diye" means X paid him N (mark_paid)'));
  assert(prompt.includes('1,000 → 1000'));
});
