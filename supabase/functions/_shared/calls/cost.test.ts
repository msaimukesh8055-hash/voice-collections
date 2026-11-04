// supabase/functions/_shared/calls/cost.test.ts
// Call cost (M6): money, 100% tested.
import { assertEquals } from '@std/assert';
import { callCost } from './cost.ts';

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
