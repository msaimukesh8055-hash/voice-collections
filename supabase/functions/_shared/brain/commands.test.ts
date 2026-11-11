// supabase/functions/_shared/brain/commands.test.ts
import { assertEquals } from '@std/assert';
import { isPromiseToPay, parseCommand } from './commands.ts';

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

Deno.test('commands › "pay" with a due date, "will/has to" or credit goes to the LLM (M6 smoke)', () => {
  for (
    const text of [
      // The live voice note (Saaras translit) that was read as a payment.
      'Ramesh ki 5000 15th varaku malla then um anthe Ramesh will pay 5000 by 15th credit ichchaanu thanaki.',
      'Ramesh will pay 5000 by 15th',
      'Ramesh will pay 5000',
      'Latha naaku Rs. 5000 pay cheyaali',
      'Latha 5000 November 15th lo pay chesthundi',
      'Salim 2000 payment dena hai',
      'Salim 2000 pay karega',
      'Ramesh 5000 credit, payment later',
      'Ramesh paid 2000 due 20th',
    ]
  ) {
    assertEquals(parse(text), null, text);
  }
});

Deno.test('commands › "ichchaanu" (I gave) spelt either way reads as credit, not a name', () => {
  for (
    const text of ['Ramesh ki 5000 ichchaanu', 'Ramesh ki 5000 ichchanu', 'Ramesh ki 5000 ichaanu']
  ) {
    const command = parse(text);
    assertEquals(command?.kind === 'add_credit' ? [command.name, command.note] : null, [
      'Ramesh',
      null,
    ], text);
  }
});

Deno.test('commands › Telugu or Hindi script goes to the LLM, except Hindi "X ने N दिए"', () => {
  assertEquals(parse('రమేష్ 2000 కట్టాడు'), null);
  assertEquals(parse('रमेश को 2000 का माल दिया'), null);
  assertEquals(parse('रमेश ने 2000 कल देने को कहा'), null);
  // Dry-run fix 3: the one clear Hindi payment shape is read in code (name checked by interpret).
  assertEquals(parse('रमेश ने 2000 दिए'), { kind: 'mark_paid', name: 'Ramesh', amount: 2000 });
});

Deno.test('commands › "call X" in plain words is a call request, never a direct remind', () => {
  assertEquals(parse('call Ramesh'), { kind: 'call_request', name: 'Ramesh' });
  assertEquals(parse('Call Ramesh now'), { kind: 'call_request', name: 'Ramesh' });
  assertEquals(parse('Please call Ramesh and remind him.'), {
    kind: 'call_request',
    name: 'Ramesh',
  });
  assertEquals(parse('remind Ramesh'), { kind: 'remind', name: 'Ramesh' });
});

Deno.test('commands › a typed note that only says "given today" is dropped', () => {
  const credit = parse('Ramesh 5000 given today');
  assertEquals(credit?.kind === 'add_credit' ? credit.note : 'x', null);
  const rice = parse('Ramesh 5000 rice bags');
  assertEquals(rice?.kind === 'add_credit' ? rice.note : 'x', 'rice bags');
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

Deno.test('commands › "insights" / "report" and "dashboard" (M6)', () => {
  for (
    const text of ['insights', 'Insights', 'report', 'stats', 'report chupinchu', 'రిపోర్ట్', 'रिपोर्ट']
  ) {
    assertEquals(parse(text), { kind: 'insights' }, text);
  }
  for (const text of ['dashboard', 'Dashboard link', 'open dashboard']) {
    assertEquals(parse(text), { kind: 'dashboard' }, text);
  }
});

Deno.test('commands › "gave me" is a payment to the owner; "gave" alone is still credit (M9)', () => {
  assertEquals(parseCommand('Praveen gave me 1,000 rupees yesterday', TODAY)?.kind, 'mark_paid');
  const paid = parseCommand('Praveen gave me 1000', TODAY);
  assertEquals(paid, { kind: 'mark_paid', name: 'Praveen', amount: 1000 });
  assertEquals(parseCommand('Praveen has given us 2500', TODAY)?.kind, 'mark_paid');
  assertEquals(parseCommand('gave Praveen 1000', TODAY)?.kind, 'add_credit');
});

Deno.test('commands › a promise to pay later is recognised; a credit with a due date is not one', () => {
  assertEquals(isPromiseToPay('Ramesh will pay 5000 by 15th'), true);
  assertEquals(isPromiseToPay('Suresh has to pay later, 2000'), true);
  assertEquals(isPromiseToPay('Ramesh will pay 5000 by 15th credit ichchaanu'), false);
  assertEquals(isPromiseToPay('Ramesh paid 5000'), false);
  assertEquals(isPromiseToPay('Ramesh 5000 due 15th'), false);
});
