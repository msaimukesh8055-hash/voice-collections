// supabase/functions/_shared/calls/cost.test.ts
// Call cost (M6): money, 100% tested.
import { assertEquals } from '@std/assert';
import { callCost, llmCost, voiceCost } from './cost.ts';

Deno.test('cost › live calls: whole minutes, rounded up, ₹3.50 + 18% GST', () => {
  assertEquals(callCost({ mode: 'live', durationSeconds: 60 }), { inr: 4.13, estimate: false });
  assertEquals(callCost({ mode: 'live', durationSeconds: 61 }), { inr: 8.26, estimate: false });
  assertEquals(callCost({ mode: 'live', durationSeconds: 170 }), { inr: 12.39, estimate: false });
});

Deno.test('cost › a live call that never connected costs nothing', () => {
  assertEquals(callCost({ mode: 'live', durationSeconds: null }), { inr: 0, estimate: false });
  assertEquals(callCost({ mode: 'live', durationSeconds: 0 }), { inr: 0, estimate: false });
});

Deno.test('cost › a simulated call is an estimate of about ₹1', () => {
  assertEquals(callCost({ mode: 'simulated', durationSeconds: null }), { inr: 1, estimate: true });
});

Deno.test('cost › voice minutes: ₹3.50 a minute + 18% GST', () => {
  assertEquals(voiceCost(0), 0);
  assertEquals(voiceCost(1), 4.13);
  assertEquals(voiceCost(10), 41.3);
});

Deno.test('cost › Sarvam tokens: ₹29.28 in and ₹73.20 out per million, + 18% GST', () => {
  assertEquals(llmCost('sarvam', { input: 1_000_000, output: 0 }), 34.55);
  assertEquals(llmCost('sarvam', { input: 0, output: 1_000_000 }), 86.38);
  assertEquals(llmCost('sarvam', { input: 812, output: 44 }), 0.03);
  assertEquals(llmCost('sarvam', { input: 0, output: 0 }), 0);
});

Deno.test('cost › Gemini is on the free tier; an unknown provider is priced at nothing', () => {
  assertEquals(llmCost('gemini', { input: 5_000_000, output: 5_000_000 }), 0);
  assertEquals(llmCost('someone-else', { input: 5_000_000, output: 5_000_000 }), 0);
});
