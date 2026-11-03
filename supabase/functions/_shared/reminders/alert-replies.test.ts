// supabase/functions/_shared/reminders/alert-replies.test.ts
// Due alert replies (M5 test list): sections, ≤3 people → buttons, >3 → list (max 10), remind-all
// offer, and the template for outside the 24-hour window. FAKE data.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { RAMESH } from '../db/fake-book-repository.ts';
import { NO_DUES } from '../ledger/dues.ts';
import type { DueAlert, DuePerson, DueReason } from '../ledger/due-alert.ts';
import { replyText } from '../whatsapp/replies.ts';
import {
  dailyAlertTemplate,
  dueAlertReplies,
  SECTION_ROWS,
  templateText,
} from './alert-replies.ts';

const TODAY = '2026-11-02';

function shopkeeper(n: number): BookShopkeeper {
  const id = `5e000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`;
  return { id, name: `Person${n}`, shopName: `Shop${n}`, area: 'Old Town', language: 'te' };
}

function person(reason: DueReason, who: BookShopkeeper = RAMESH): DuePerson {
  return {
    shopkeeper: who,
    reason,
    dues: {
      ...NO_DUES,
      outstanding: 8500,
      overdueAmount: 5000,
      daysOverdue: 12,
      nextDueAmount: 1500,
    },
    brokenPromise: reason === 'broken_promise' ? { amount: 3000, promiseDate: '2026-10-30' } : null,
  };
}

function alertOf(people: readonly DuePerson[]): DueAlert {
  const by = (reason: DueReason): DuePerson[] => people.filter((p) => p.reason === reason);
  return {
    brokenPromise: by('broken_promise'),
    overdue: by('overdue'),
    dueToday: by('due_today'),
    people,
  };
}

Deno.test('alert replies › nobody due → one short line, no buttons', () => {
  const replies = dueAlertReplies(alertOf([]), TODAY, 'en');
  assertEquals(replies, [{ kind: 'text', text: 'Nobody is due or overdue today.' }]);
});

Deno.test('alert replies › one person: the alert and one Remind button, no remind-all', () => {
  const replies = dueAlertReplies(alertOf([person('broken_promise')]), TODAY, 'en');
  assertEquals(replies.length, 2);
  const text = replyText(replies);
  assertStringIncludes(text, 'Broke a promise* (1)');
  assertStringIncludes(
    text,
    'Ramesh (Ramesh Kirana) · promised ₹3,000 by Fri 30 Oct · owes ₹8,500',
  );
  const picker = replies[1];
  assert(picker?.kind === 'buttons');
  assertEquals(picker.buttons[0]?.title, 'Remind Ramesh');
  assertEquals(parseTap(picker.buttons[0]?.id ?? ''), {
    kind: 'remind',
    shopkeeperId: RAMESH.id,
    language: 'en',
  });
});

Deno.test('alert replies › up to 3 people get buttons plus a Remind all due offer', () => {
  const people = [person('overdue', shopkeeper(1)), person('due_today', shopkeeper(2))];
  const replies = dueAlertReplies(alertOf(people), TODAY, 'en');
  assertEquals(replies.map((r) => r.kind), ['text', 'buttons', 'buttons']);
  const text = replyText(replies);
  assertStringIncludes(text, 'Person1 (Shop1) · ₹5,000 · 12 days overdue');
  assertStringIncludes(text, 'Person2 (Shop2) · ₹1,500 due today');
  const offer = replies[2];
  assert(offer?.kind === 'buttons');
  assertEquals(parseTap(offer.buttons[0]?.id ?? ''), { kind: 'remind_all', language: 'en' });
  assertStringIncludes(offer.text, '2 people');
});

Deno.test('alert replies › more than 3 people get a list of at most 10', () => {
  const people = Array.from({ length: 12 }, (_, n) => person('overdue', shopkeeper(n)));
  const replies = dueAlertReplies(alertOf(people), TODAY, 'en');
  const list = replies[1];
  assert(list?.kind === 'list');
  assertEquals(list.rows.length, 10);
  assertEquals(list.rows[0]?.description, '₹5,000 · 12 days overdue');
  assertEquals(parseTap(list.rows[9]?.id ?? '')?.kind, 'remind');
});

Deno.test('alert replies › list rows describe each reason', () => {
  const people = [
    person('broken_promise', shopkeeper(1)),
    person('overdue', shopkeeper(2)),
    person('due_today', shopkeeper(3)),
    person('due_today', shopkeeper(4)),
  ];
  const replies = dueAlertReplies(alertOf(people), TODAY, 'en');
  const list = replies[1];
  assert(list?.kind === 'list');
  assertEquals(list.rows.map((row) => row.description), [
    'broke a promise · owes ₹8,500',
    '₹5,000 · 12 days overdue',
    '₹1,500 due today',
    '₹1,500 due today',
  ]);
});

Deno.test('alert replies › a section shows 10 lines and "…and N more"', () => {
  const people = Array.from(
    { length: SECTION_ROWS + 2 },
    (_, n) => person('overdue', shopkeeper(n)),
  );
  const text = replyText([dueAlertReplies(alertOf(people), TODAY, 'en')[0]!]);
  assertStringIncludes(text, '…and 2 more');
  assertEquals(text.includes('Person11'), false);
});

Deno.test('alert replies › a shopkeeper whose name is the shop name is shown once', () => {
  const sameName = { ...shopkeeper(1), shopName: 'Person1' };
  const text = replyText(dueAlertReplies(alertOf([person('overdue', sameName)]), TODAY, 'en'));
  assertStringIncludes(text, '• Person1 · ₹5,000');
});

Deno.test('alert replies › Hindi and Telugu alerts carry the same figures', () => {
  for (const language of ['hi', 'te'] as const) {
    const replies = dueAlertReplies(
      alertOf([person('overdue'), person('due_today')]),
      TODAY,
      language,
    );
    assertStringIncludes(replyText(replies), '₹5,000');
    assertEquals(replies.length, 3);
  }
});

Deno.test('alert replies › the template carries the count and its text', () => {
  const reply = dailyAlertTemplate(7);
  assertEquals(reply, {
    kind: 'template',
    name: 'daily_due_alert',
    languageCode: 'en',
    bodyParams: ['7'],
    text: templateText(7),
  });
  assertStringIncludes(templateText(7), '7 shopkeepers are due today. Reply DUE');
});
