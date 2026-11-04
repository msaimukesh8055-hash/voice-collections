// supabase/functions/_shared/brain/suggestion.test.ts
import { assertEquals } from '@std/assert';
import { parseSuggestion, toCommand } from './suggestion.ts';

const TODAY = '2026-11-02';

function commandOf(json: unknown): ReturnType<typeof toCommand> | 'invalid' {
  const suggestion = parseSuggestion(JSON.stringify(json));
  return suggestion ? toCommand(suggestion, TODAY) : 'invalid';
}

Deno.test('suggestion › mark_paid becomes a payment command', () => {
  assertEquals(commandOf({ intent: 'mark_paid', name: 'ramesh', amount: 2000 }), {
    kind: 'mark_paid',
    name: 'Ramesh',
    amount: 2000,
  });
});

Deno.test('suggestion › add_credit keeps a future due date and drops a past one', () => {
  const base = { intent: 'add_credit', name: 'Suresh Babu', amount: 3000, note: 'rice' };
  assertEquals(commandOf({ ...base, due_date: '2026-11-15' }), {
    kind: 'add_credit',
    name: 'Suresh Babu',
    amount: 3000,
    dueDate: '2026-11-15',
    note: 'rice',
  });
  const past = commandOf({ ...base, due_date: '2026-10-01', note: '' });
  assertEquals(past !== 'invalid' && past?.kind === 'add_credit' ? past : null, {
    kind: 'add_credit',
    name: 'Suresh Babu',
    amount: 3000,
    dueDate: null,
    note: null,
  });
});

Deno.test('suggestion › ledger queries map to pending, closed and lookup', () => {
  assertEquals(commandOf({ intent: 'ledger_query', query: 'pending' }), { kind: 'pending' });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'closed', name: null }), {
    kind: 'closed',
  });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'shopkeeper', name: 'latha' }), {
    kind: 'lookup',
    name: 'Latha',
  });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'shopkeeper' }), null);
});

Deno.test('suggestion › help and unknown', () => {
  assertEquals(commandOf({ intent: 'help' }), { kind: 'help' });
  assertEquals(commandOf({ intent: 'unknown' }), null);
});

Deno.test('suggestion › code fences around the JSON are tolerated', () => {
  const content = '```json\n{"intent":"help"}\n```';
  assertEquals(parseSuggestion(content), { intent: 'help' });
});

Deno.test('suggestion › bad answers are rejected', () => {
  const invalid = [
    { intent: 'mark_paid', name: 'రమేష్', amount: 2000 },
    { intent: 'mark_paid', name: 'Ramesh', amount: -5 },
    { intent: 'mark_paid', name: 'Ramesh', amount: '2000' },
    { intent: 'save_entry', name: 'Ramesh' },
    { intent: 'add_credit', name: 'Ramesh', amount: 100, due_date: '15th' },
  ];
  for (const json of invalid) assertEquals(commandOf(json), 'invalid', JSON.stringify(json));
  assertEquals(parseSuggestion('Sure! Ramesh paid.'), null);
  assertEquals(parseSuggestion('{not json}'), null);
});

Deno.test('suggestion › add_credit without a due_date key uses the default', () => {
  const command = commandOf({ intent: 'add_credit', name: 'Latha', amount: 500 });
  assertEquals(
    command !== 'invalid' && command?.kind === 'add_credit' ? command.dueDate : 'x',
    null,
  );
});

Deno.test('suggestion › v2 queries map to due_alert, insights, dashboard and score', () => {
  assertEquals(commandOf({ intent: 'ledger_query', query: 'due_alert' }), { kind: 'due_alert' });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'insights', name: null }), {
    kind: 'insights',
  });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'dashboard' }), { kind: 'dashboard' });
  assertEquals(commandOf({ intent: 'ledger_query', query: 'score', name: 'ramesh kumar' }), {
    kind: 'score',
    name: 'Ramesh Kumar',
  });
});

Deno.test('suggestion › score without a name is "didn\'t get that"', () => {
  assertEquals(commandOf({ intent: 'ledger_query', query: 'score' }), null);
  assertEquals(commandOf({ intent: 'ledger_query', query: 'score', name: null }), null);
});

Deno.test('suggestion › remind and remind_all are never accepted from the LLM', () => {
  const invalid = [
    { intent: 'ledger_query', query: 'remind', name: 'Ramesh' },
    { intent: 'ledger_query', query: 'remind' },
    { intent: 'ledger_query', query: 'remind_all' },
    { intent: 'remind', name: 'Ramesh' },
    { intent: 'remind_all' },
  ];
  for (const json of invalid) assertEquals(commandOf(json), 'invalid', JSON.stringify(json));
});

Deno.test('suggestion › an empty-content note ("Given today") is dropped; a real one kept', () => {
  const base = { intent: 'add_credit', name: 'Salim', amount: 1000, due_date: null };
  const empty = commandOf({ ...base, note: 'Given today' });
  assertEquals(empty !== 'invalid' && empty?.kind === 'add_credit' ? empty.note : 'x', null);
  const real = commandOf({ ...base, note: 'rice bags' });
  assertEquals(real !== 'invalid' && real?.kind === 'add_credit' ? real.note : 'x', 'rice bags');
});

Deno.test('suggestion › "call" becomes a call request (a confirm card), never a remind', () => {
  assertEquals(commandOf({ intent: 'call', name: 'ramesh' }), {
    kind: 'call_request',
    name: 'Ramesh',
  });
  assertEquals(commandOf({ intent: 'call' }), 'invalid');
});
