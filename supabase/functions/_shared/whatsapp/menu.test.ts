// supabase/functions/_shared/whatsapp/menu.test.ts
// The Menu list (M7 Decision 7; M8 added Call Munshi as the 9th row): 9 rows, WhatsApp's limits in every language, English rendering
// for the twin, and the add / paid hints.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { hintReply, MENU_ITEMS, menuPhrasesFor, menuReply, sorryMenuReply } from './menu.ts';
import { MAX_INTERACTIVE_BODY, MAX_LIST_ROWS, type Reply } from './replies.ts';

/** Meta's list limits (whatsapp/client.ts cuts beyond these; ours must fit uncut). */
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
const MAX_LIST_BUTTON = 20;
const OWNER = 'Srinivas Reddy';

function listOf(reply: Reply): Extract<Reply, { kind: 'list' }> {
  if (reply.kind !== 'list') throw new Error(`not a list: ${reply.kind}`);
  return reply;
}

Deno.test('menu › 9 rows in the agreed order, each an mn: id in the reply language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const menu = listOf(menuReply(language, OWNER));
    assertEquals(menu.rows.length, 9);
    assert(menu.rows.length <= MAX_LIST_ROWS);
    const items = menu.rows.map((row) => {
      const tap = parseTap(row.id);
      return tap?.kind === 'menu' && tap.language === language ? tap.item : null;
    });
    assertEquals(items, [...MENU_ITEMS]);
  }
});

Deno.test('menu › every title, description, button and body fits WhatsApp in EN/HI/TE', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    for (const reply of [menuReply(language, OWNER), sorryMenuReply(language, OWNER)]) {
      const menu = listOf(reply);
      assert(menu.buttonLabel.length <= MAX_LIST_BUTTON, language);
      assert(menu.text.length <= MAX_INTERACTIVE_BODY, language);
      for (const row of menu.rows) {
        assert(row.title.length <= MAX_ROW_TITLE, `${language} ${row.title}`);
        assert((row.description ?? '').length <= MAX_ROW_DESCRIPTION, `${language} ${row.id}`);
      }
    }
  }
});

Deno.test('menu › the English body: greeting by first name, how to choose, nothing saved', () => {
  assertEquals(
    menuReply('en', OWNER).kind === 'list' ? menuReply('en', OWNER) : null,
    {
      kind: 'list',
      text: '👋 *Namaste Srinivas!* I keep your credit book.\n\n' +
        'Tap *Menu* to choose, or just type or send a voice note.\n\n' +
        'Nothing is saved until you tap Save.',
      buttonLabel: 'Menu',
      rows: listOf(menuReply('en', OWNER)).rows,
    },
  );
  assertEquals(listOf(menuReply('en', OWNER)).rows[0], {
    id: 'mn:pending:en',
    title: '📒 Pending',
    description: 'Who owes you, biggest first',
  });
});

Deno.test('menu › Hindi and Telugu carry the English body for the twin; rows stay in language', () => {
  const english = listOf(menuReply('en', OWNER)).text;
  for (const language of ['hi', 'te'] as const) {
    const menu = listOf(menuReply(language, OWNER));
    assertEquals(menu.english, english, language);
    assertEquals(menu.buttonLabel, menuPhrasesFor(language).listButton);
    assertEquals(menu.rows[0]?.title, menuPhrasesFor(language).rows.pending.title);
  }
  assertStringIncludes(listOf(menuReply('te', OWNER)).text, 'Srinivas గారు');
  assertStringIncludes(listOf(menuReply('hi', OWNER)).text, 'Srinivas जी');
  assertEquals(listOf(menuReply('en', OWNER)).english, undefined);
});

Deno.test('menu › "Sorry" comes on top of the same Menu', () => {
  const sorry = listOf(sorryMenuReply('en', OWNER));
  assertEquals(sorry.text, `Sorry, I didn't get that.\n\n${listOf(menuReply('en', OWNER)).text}`);
  assertEquals(sorry.rows, listOf(menuReply('en', OWNER)).rows);
  const te = listOf(sorryMenuReply('te', OWNER));
  assert(te.english?.startsWith("Sorry, I didn't get that."), te.english);
});

Deno.test('menu › hints: add credit and mark paid, with an English rendering', () => {
  assertEquals(hintReply('add', 'en'), {
    kind: 'text',
    text: '🧾 *Add credit*\n\nType or say it in one line, e.g. *Ramesh 5000 due 15th*\n\n' +
      "I'll show a card first. Nothing is saved until you tap Save.",
  });
  const paid = hintReply('paid', 'te');
  assertStringIncludes(paid.kind === 'text' ? paid.text : '', '*Ramesh paid 2000*');
  assertEquals(
    paid.kind === 'text' ? paid.english?.split('\n')[0] : '',
    '💰 *Mark paid*',
  );
});

Deno.test('menu › a one-word owner name is used as it is', () => {
  assertStringIncludes(listOf(menuReply('en', 'Srinivas')).text, 'Namaste Srinivas!');
});

/** The 8 M7 rows as they were before M8 (English): ids, titles and descriptions unchanged. */
const M7_ROWS_EN = [
  ['mn:pending:en', '📒 Pending', 'Who owes you, biggest first'],
  ['mn:due:en', '🔔 Due today', 'Who is due or overdue, with Remind'],
  ['mn:add:en', '🧾 Add credit', 'How to add credit by text or voice'],
  ['mn:paid:en', '💰 Mark paid', 'How to record a payment'],
  ['mn:closed:en', '✅ Paid off', 'Cleared this month'],
  ['mn:insights:en', '📊 Insights', 'Pie chart, % collected, top 5'],
  ['mn:dashboard:en', '🖥️ Dashboard', 'Link to the web dashboard'],
  ['mn:remind_all:en', '📞 Remind all due', 'Asks before calling anyone'],
];

Deno.test('menu › M8: the 8 old rows are unchanged and Call Munshi is the 9th, last row', () => {
  const rows = listOf(menuReply('en', OWNER)).rows;
  assertEquals(
    rows.slice(0, 8).map((row) => [row.id, row.title, row.description]),
    M7_ROWS_EN,
  );
  assertEquals(rows[8], {
    id: 'mn:munshi:en',
    title: '📞 Call Munshi',
    description: 'Talk to your book: ask, add, mark paid',
  });
  assertEquals(listOf(menuReply('hi', OWNER)).rows[8]?.title, '📞 मुंशी को कॉल करें');
  assertEquals(listOf(menuReply('te', OWNER)).rows[8]?.title, '📞 మున్షీకి కాల్');
});
