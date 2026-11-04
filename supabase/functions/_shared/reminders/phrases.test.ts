// supabase/functions/_shared/reminders/phrases.test.ts
// Every reminder line exists in English, Hindi and Telugu, keeps its figures as digits, and the
// optional parts (skips, the live name, simulated count) appear only when they apply.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { type BrokenPromiseLine, type RemindBlock, reminderPhrasesFor } from './phrases.ts';

const BROKEN_LINE: BrokenPromiseLine = {
  label: 'Ramesh',
  promised: '₹3,000',
  day: 'Fri 30 Oct',
  owed: '₹8,500',
};

const BLOCKS: readonly RemindBlock[] = [
  'DO_NOT_CALL',
  'OUTSIDE_CALLING_HOURS',
  'ATTEMPT_LIMIT_REACHED',
  'RATE_LIMITED',
  'NOT_FOUND',
];

Deno.test('reminder phrases › every line in every language, figures kept', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const p = reminderPhrasesFor(language);
    const lines = [
      p.alertTitle('Mon 2 Nov'),
      p.sectionBroken(1),
      p.sectionOverdue(2),
      p.sectionDueToday(3),
      p.brokenLine(BROKEN_LINE),
      p.overdueLine('Latha', '₹2,000', 8),
      p.dueTodayLine('Suresh', '₹900'),
      p.nobodyDue,
      p.pickerText,
      p.remindButton('Ramesh'),
      p.listButton,
      p.rowBroken('₹8,500'),
      p.rowOverdue('₹2,000', 8),
      p.rowDueToday('₹900'),
      p.remindAllText(7),
      p.remindAllButton,
      p.ringing('Ramesh'),
      p.alreadyCalling('Latha'),
      ...BLOCKS.map((code) => p.blocked(code, 'Latha')),
      p.confirmAll(7),
      p.confirmAll(1),
      p.nobodyToCall,
      p.notCalled(2),
      p.scoreTitle('Ramesh', 42, 'Risky'),
      p.paidOnTime(30, 3, 4),
      p.promisesKept(15, 1, 2),
      p.currentOverdue(16, 12),
      p.answersCalls(5, 1, 2),
      p.nothingYet,
      p.newBand,
    ];
    for (const line of lines) assert(line.trim().length > 0, `${language}: empty line`);
    assertStringIncludes(p.brokenLine(BROKEN_LINE), '₹3,000');
    assertStringIncludes(p.scoreTitle('Ramesh', 42, 'Risky'), '42/100');
  }
});

Deno.test('reminder phrases › skips list only what happened', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const p = reminderPhrasesFor(language);
    assertEquals(p.skipped({ recent: 0, paused: 0, doNotCall: 0, notIncluded: 0 }), []);
    assertEquals(p.skipped({ recent: 1, paused: 2, doNotCall: 3, notIncluded: 4 }).length, 4);
  }
});

Deno.test('reminder phrases › started-all gives the count and the 4-at-a-time limit', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    assertStringIncludes(reminderPhrasesFor(language).startedAll(7), '7');
    assertStringIncludes(reminderPhrasesFor(language).startedAll(7), '4');
  }
  assertStringIncludes(reminderPhrasesFor('en').startedAll(1), 'Calling 1 person with simulated');
  assertStringIncludes(reminderPhrasesFor('en').startedAll(2), 'Calling 2 people with simulated');
});

Deno.test('reminder phrases › one-person Remind says it rings on the phone page, as that person', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const line = reminderPhrasesFor(language).ringing('Imran');
    assertEquals(line.split('Imran').length - 1, 2, `${language}: name twice`);
  }
  assertStringIncludes(reminderPhrasesFor('en').ringing('Imran'), 'rings on the phone page');
});
