// supabase/functions/_shared/owner-tools/wrap-up.test.ts
import { assertEquals } from '@std/assert';
import { isWrapUpTime, withWrapUp, WRAP_UP_AFTER_MS, WRAP_UP_NOTE } from './wrap-up.ts';

const ACCEPTED = '2026-11-02T06:29:00.000Z';

function at(ms: number): Date {
  return new Date(Date.parse(ACCEPTED) + ms);
}

Deno.test('wrap-up › from 7:00 after Start call, not before; never without an accept time', () => {
  assertEquals(isWrapUpTime(ACCEPTED, at(WRAP_UP_AFTER_MS - 1)), false);
  assertEquals(isWrapUpTime(ACCEPTED, at(WRAP_UP_AFTER_MS)), true);
  assertEquals(isWrapUpTime(null, at(WRAP_UP_AFTER_MS * 2)), false);
});

Deno.test('wrap-up › the note is added to replies and refusals alike', () => {
  const ok = { ok: true as const, say: 'Total pending: 10 rupees.', data: {} };
  const refused = { ok: false as const, code: 'NOT_FOUND', say: 'Nobody by that name.' };
  assertEquals(withWrapUp(ok, ACCEPTED, at(0)), ok);
  assertEquals(withWrapUp(ok, ACCEPTED, at(WRAP_UP_AFTER_MS)).say, `${ok.say} ${WRAP_UP_NOTE}`);
  assertEquals(
    withWrapUp(refused, ACCEPTED, at(WRAP_UP_AFTER_MS)).say,
    `${refused.say} ${WRAP_UP_NOTE}`,
  );
});
