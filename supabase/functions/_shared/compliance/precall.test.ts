// supabase/functions/_shared/compliance/precall.test.ts
import { assertEquals } from '@std/assert';
import { checkPrecall, type PrecallInput } from './precall.ts';

/** Builds a UTC instant for a given India (IST) time on 2026-11-01. */
function ist(time: string): Date {
  return new Date(`2026-11-01T${time}:00+05:30`);
}

const ALLOWED_INPUT: PrecallInput = {
  now: ist('12:00'),
  doNotCall: false,
  callingHoursEnabled: true,
  callLimitsEnabled: false,
  callsToday: 0,
  callsThisWeek: 0,
};

Deno.test('checkPrecall › allows a call at noon IST', () => {
  assertEquals(checkPrecall(ALLOWED_INPUT), { allowed: true });
});

Deno.test('checkPrecall › calling-hour edges: 07:59 and 19:00 blocked, 08:00 and 18:59 allowed', () => {
  const blocked = { allowed: false, code: 'OUTSIDE_CALLING_HOURS' } as const;
  assertEquals(checkPrecall({ ...ALLOWED_INPUT, now: ist('07:59') }), blocked);
  assertEquals(checkPrecall({ ...ALLOWED_INPUT, now: ist('08:00') }), { allowed: true });
  assertEquals(checkPrecall({ ...ALLOWED_INPUT, now: ist('18:59') }), { allowed: true });
  assertEquals(checkPrecall({ ...ALLOWED_INPUT, now: ist('19:00') }), blocked);
});

Deno.test('checkPrecall › blocks a 21:00 demo-clock call', () => {
  const result = checkPrecall({ ...ALLOWED_INPUT, now: ist('21:00') });
  assertEquals(result, { allowed: false, code: 'OUTSIDE_CALLING_HOURS' });
});

Deno.test('checkPrecall › blocks do-not-call customers at any hour', () => {
  const result = checkPrecall({ ...ALLOWED_INPUT, doNotCall: true });
  assertEquals(result, { allowed: false, code: 'DO_NOT_CALL' });
});

Deno.test('checkPrecall › ignores attempt counts when limits are switched off', () => {
  const result = checkPrecall({ ...ALLOWED_INPUT, callsToday: 50, callsThisWeek: 99 });
  assertEquals(result, { allowed: true });
});

Deno.test('checkPrecall › with limits on, 3rd call today allowed and 4th blocked', () => {
  const on = { ...ALLOWED_INPUT, callLimitsEnabled: true };
  assertEquals(checkPrecall({ ...on, callsToday: 2, callsThisWeek: 2 }), { allowed: true });
  assertEquals(checkPrecall({ ...on, callsToday: 3, callsThisWeek: 3 }), {
    allowed: false,
    code: 'ATTEMPT_LIMIT_REACHED',
  });
});

Deno.test('checkPrecall › with limits on, 7th call this week allowed and 8th blocked', () => {
  const on = { ...ALLOWED_INPUT, callLimitsEnabled: true };
  assertEquals(checkPrecall({ ...on, callsToday: 0, callsThisWeek: 6 }), { allowed: true });
  assertEquals(checkPrecall({ ...on, callsToday: 0, callsThisWeek: 7 }), {
    allowed: false,
    code: 'ATTEMPT_LIMIT_REACHED',
  });
});

Deno.test('checkPrecall › with the calling-hours switch off, any hour is allowed', () => {
  const off = { ...ALLOWED_INPUT, callingHoursEnabled: false };
  assertEquals(checkPrecall({ ...off, now: ist('21:00') }), { allowed: true });
  assertEquals(checkPrecall({ ...off, now: ist('07:59') }), { allowed: true });
});

Deno.test('checkPrecall › do-not-call still blocks when the calling-hours switch is off', () => {
  const result = checkPrecall({ ...ALLOWED_INPUT, callingHoursEnabled: false, doNotCall: true });
  assertEquals(result, { allowed: false, code: 'DO_NOT_CALL' });
});
