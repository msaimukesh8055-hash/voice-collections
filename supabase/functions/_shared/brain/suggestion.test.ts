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
