// supabase/functions/_shared/brain/commands.test.ts
import { assertEquals } from '@std/assert';
import { parseCommand } from './commands.ts';

/** Monday 2 November 2026. */
const TODAY = '2026-11-02';

function parse(text: string): ReturnType<typeof parseCommand> {
  return parseCommand(text, TODAY);
}

Deno.test('commands › help in three languages and scripts', () => {
  for (const text of ['hi', 'Hello!', 'help', 'namaste', 'Namaskaram', 'నమస్కారం', 'नमस्ते']) {
    assertEquals(parse(text), { kind: 'help' }, text);
  }
});

Deno.test('commands › pending and closed, any case', () => {
  for (const text of ['pending', 'PENDING', 'who owes me?', 'baaki', 'bakilu']) {
    assertEquals(parse(text), { kind: 'pending' }, text);
  }
  assertEquals(parse('Closed'), { kind: 'closed' });
});

Deno.test('commands › a bare name is a lookup', () => {
  assertEquals(parse('Ramesh'), { kind: 'lookup', name: 'Ramesh' });
  assertEquals(parse('ramesh kirana'), { kind: 'lookup', name: 'Ramesh Kirana' });
});

Deno.test('commands › add credit with a due date (English)', () => {
  assertEquals(parse('Ramesh 5000 due 15th'), {
    kind: 'add_credit',
    name: 'Ramesh',
    amount: 5000,
    dueDate: '2026-11-15',
    note: null,
  });
  assertEquals(parse('Ramesh 5000, due 15th')?.kind, 'add_credit');
});

Deno.test('commands › add credit without a date leaves it for the 15-day default', () => {
  assertEquals(parse('Suresh Babu 3000'), {
    kind: 'add_credit',
    name: 'Suresh Babu',
    amount: 3000,
    dueDate: null,
    note: null,
  });
});

Deno.test('commands › amounts like 5k, 5,000 and ₹5000 all read as 5000', () => {
  for (const text of ['Ramesh 5k', 'Ramesh 5,000', 'Ramesh ₹5000', 'Ramesh Rs.5000/-']) {
    const command = parse(text);
    assertEquals(command?.kind === 'add_credit' ? command.amount : null, 5000, text);
  }
});

Deno.test('commands › words after the amount become a short note', () => {
  const command = parse('Ramesh 5000 rice bags due 20th');
  assertEquals(command?.kind === 'add_credit' ? [command.note, command.dueDate] : null, [
    'rice bags',
    '2026-11-20',
  ]);
});

Deno.test('commands › add credit in Hindi and Telugu (Latin letters)', () => {
  assertEquals(parse('Ramesh ko 5000 udhaar diya 15 tak'), {
    kind: 'add_credit',
    name: 'Ramesh',
    amount: 5000,
    dueDate: '2026-11-15',
    note: null,
  });
  const telugu = parse('Ramesh ki 5000 appu');
  assertEquals(telugu?.kind === 'add_credit' ? telugu.name : null, 'Ramesh');
});

Deno.test('commands › mark paid in English, Hindi and Telugu (Latin letters)', () => {
  const expected = { kind: 'mark_paid', name: 'Ramesh', amount: 2000 } as const;
  for (
    const text of [
      'Ramesh paid 2000',
      'ramesh paid ₹2,000',
      'received 2000 from Ramesh',
      'Ramesh ne 2000 diye',
      'Ramesh 2000 jama',
      'Ramesh 2000 kattadu',
      'Ramesh garu 2k ichadu',
    ]
  ) {
    assertEquals(parse(text), expected, text);
  }
});

Deno.test('commands › Telugu or Hindi script goes to the LLM', () => {
  assertEquals(parse('రమేష్ 2000 కట్టాడు'), null);
  assertEquals(parse('रमेश ने 2000 दिए'), null);
});

Deno.test('commands › questions and long names go to the LLM', () => {
  assertEquals(parse('how much does ramesh owe me now'), null);
  assertEquals(parse('5000'), null);
  assertEquals(parse('paid 2000'), null);
  assertEquals(parse('one two three four five 2000'), null);
  assertEquals(parse('ramesh ok?'), { kind: 'lookup', name: 'Ramesh Ok' });
});

Deno.test('commands › due alert: "who is due?", "due", the template reply (M5)', () => {
  for (
    const text of ['due', 'DUE', 'who is due?', 'Who is due today?', 'aaj ka due', 'evaru due']
  ) {
    assertEquals(parse(text), { kind: 'due_alert' }, text);
  }
  assertEquals(parse('dues'), { kind: 'pending' });
});

Deno.test('commands › remind all and remind one (M5)', () => {
  for (const text of ['remind all', 'Remind everyone!', 'remind all due', 'sabko remind']) {
    assertEquals(parse(text), { kind: 'remind_all' }, text);
  }
  assertEquals(parse('remind Ramesh'), { kind: 'remind', name: 'Ramesh' });
  assertEquals(parse('Remind ramesh kirana'), { kind: 'remind', name: 'Ramesh Kirana' });
  assertEquals(parse('remind a b c d e'), null);
});

Deno.test('commands › score explain: "why is X N?" and "X score" (M5)', () => {
  for (
    const text of [
      'why is Ramesh 42?',
      "Why is Ramesh's score 42",
      'why does ramesh have 42',
      'why is ramesh only 42',
      'Ramesh score',
      "ramesh's score",
      'score of Ramesh',
      'score ramesh',
    ]
  ) {
    assertEquals(parse(text), { kind: 'score', name: 'Ramesh' }, text);
  }
  assertEquals(parse('why is Ramesh Kirana 42'), { kind: 'score', name: 'Ramesh Kirana' });
  assertEquals(parse('why is ramesh 4200')?.kind === 'score', false);
});

Deno.test('commands › "overdue" and "who is overdue?" open the due alert (M6)', () => {
  for (
    const text of ['overdue', 'Overdue', 'who is overdue?', "who's overdue", 'overdue list']
  ) {
    assertEquals(parse(text), { kind: 'due_alert' }, text);
  }
});
