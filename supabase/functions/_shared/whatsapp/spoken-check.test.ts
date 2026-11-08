// supabase/functions/_shared/whatsapp/spoken-check.test.ts
// The safety checks on the spoken summary (M7 Decision 4): LLM-output validation, 100% tested.
// Any failure means the voice note falls back to today's flat spokenText.
import { assertEquals } from '@std/assert';
import { checkSpoken, type SpokenCheckInput } from './spoken-check.ts';
import { MAX_SPOKEN_CHARS } from './spoken.ts';

const NAMES = ['Srinivas Reddy', 'Ramesh', 'Ramesh Kirana', 'Imran', 'Imran Provisions'];
const SOURCE_EN = '*Add credit*\n\nRamesh (Ramesh Kirana)\n₹5,000 · due Sun 15 Nov\n\n' +
  'Balance after: ₹13,500\nSave\nEdit\nCancel';

function en(source = SOURCE_EN): SpokenCheckInput {
  return { source, language: 'en', names: NAMES };
}

const TE_SOURCE = '*అప్పు జోడించండి*\n\nRamesh (Ramesh Kirana)\n₹5,000 · గడువు Sun 15 Nov\n\n' +
  'తర్వాత బాకీ: ₹13,500\nSave';
const HI_SOURCE = '*उधार जोड़ें*\n\nRamesh (Ramesh Kirana)\n₹5,000 · देय Sun 15 Nov\n\n' +
  'बाद में बाकी: ₹13,500\nSave';

function reasonOf(say: string, input: SpokenCheckInput): string {
  const result = checkSpoken(say, input);
  return result.ok ? 'ok' : result.reason;
}

Deno.test('spoken check › a correct English summary passes (plan example)', () => {
  const say =
    "Srinivas, I've got Ramesh down for 5,000 rupees of credit, due Sunday 15 November. " +
    'That takes him to 13,500 rupees. If it looks right, just tap Save.';
  assertEquals(checkSpoken(say, en()), { ok: true });
});

Deno.test('spoken check › correct Telugu and Hindi summaries pass', () => {
  const te = 'Srinivas గారు, Ramesh కి 5,000 రూపాయలు అప్పు, 15 Nov గడువు. ' +
    'మొత్తం 13,500 రూపాయలు. సరిగ్గా ఉంటే Save నొక్కండి.';
  assertEquals(checkSpoken(te, { source: TE_SOURCE, language: 'te', names: NAMES }), { ok: true });
  const hi =
    'Srinivas जी, Ramesh को 5,000 रुपये उधार, 15 Nov तक। अब कुल 13,500 रुपये। ठीक है तो Save दबाइए।';
  assertEquals(checkSpoken(hi, { source: HI_SOURCE, language: 'hi', names: NAMES }), { ok: true });
});

Deno.test('spoken check › empty or too long → bad_json / too_long', () => {
  assertEquals(reasonOf('   ', en()), 'bad_json');
  assertEquals(reasonOf('Save. '.repeat(120), en()), 'too_long');
  assertEquals(MAX_SPOKEN_CHARS, 600);
  assertEquals(reasonOf(`${'a'.repeat(599)} `, en()), 'ok');
});

Deno.test('spoken check › any link is refused', () => {
  for (
    const say of ['Open https://x.example now.', 'See http://x.example', 'Go to www.x.example']
  ) {
    assertEquals(reasonOf(say, en()), 'link', say);
  }
});

Deno.test('spoken check › the script must match the language', () => {
  assertEquals(reasonOf('Ramesh 5,000 rupees.', { ...en(TE_SOURCE), language: 'te' }), 'script');
  assertEquals(reasonOf('Ramesh 5,000 rupees.', { ...en(HI_SOURCE), language: 'hi' }), 'script');
  assertEquals(reasonOf('Ramesh కి 5,000.', en()), 'script');
  assertEquals(reasonOf('Ramesh को 5,000.', en()), 'script');
});

Deno.test('spoken check › a number not in the reply is refused', () => {
  assertEquals(reasonOf('Ramesh owes 6,000 rupees.', en()), 'number');
  assertEquals(reasonOf('Three people: 3 of them.', en()), 'number');
});

Deno.test('spoken check › commas are ignored: 13500 = ₹13,500, 1,84,000 = 184000', () => {
  assertEquals(reasonOf('Ramesh now owes 13500 rupees.', en()), 'ok');
  const lakh = 'Pending: ₹1,84,000 in all';
  assertEquals(reasonOf('In all 184000 rupees.', en(lakh)), 'ok');
  assertEquals(reasonOf('In all 1,84,000 rupees.', en('Pending: ₹184000')), 'ok');
  assertEquals(reasonOf('In all 18,400 rupees.', en(lakh)), 'number');
});

Deno.test('spoken check › Devanagari and Telugu digits are compared as numbers too', () => {
  const hi = { source: HI_SOURCE, language: 'hi' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh को ५,००० रुपये।', hi), 'ok');
  assertEquals(reasonOf('Ramesh को ६,००० रुपये।', hi), 'number');
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh కి ౫,౦౦౦ రూపాయలు.', te), 'ok');
  assertEquals(reasonOf('Ramesh కి ౬,౦౦౦ రూపాయలు.', te), 'number');
});

Deno.test('spoken check › decimals and leading zeros are the same number', () => {
  assertEquals(reasonOf('He paid 1250.5 rupees.', en('Paid ₹1,250.50')), 'ok');
  assertEquals(reasonOf('Due on the 05th.', en('due 5 Nov')), 'ok');
});

Deno.test('spoken check › amounts in words are refused (EN, HI, TE)', () => {
  assertEquals(reasonOf('Ramesh owes 5 thousand rupees.', en()), 'number_word');
  assertEquals(reasonOf('About one Lakh in all.', en()), 'number_word');
  assertEquals(reasonOf('Ramesh 5 hazaar.', en()), 'number_word');
  const hi = { source: HI_SOURCE, language: 'hi' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh को पाँच हज़ार रुपये।', hi), 'number_word');
  assertEquals(reasonOf('Ramesh को पाँच हज़ार रुपये।'.normalize('NFD'), hi), 'number_word');
  assertEquals(reasonOf('Ramesh पर दो लाख।', hi), 'number_word');
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh కి ఐదు వేలు రూపాయలు.', te), 'number_word');
  assertEquals(reasonOf('Ramesh కి ఐదు వేల రూపాయలు.', te), 'number_word');
  assertEquals(reasonOf('Ramesh కి రెండు లక్షలు.', te), 'number_word');
});

Deno.test('spoken check › a known name that is not in the reply is refused', () => {
  assertEquals(reasonOf('Imran owes 5,000 rupees.', en()), 'name');
  assertEquals(reasonOf('Ramesh at imran provisions, 5,000 rupees.', en()), 'name');
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Imranకి 5,000 రూపాయలు.', te), 'name');
});

Deno.test('spoken check › a name inside a longer word is not that name', () => {
  const names = ['Ram'];
  assertEquals(checkSpoken('Ramesh owes 5,000 rupees.', { ...en(), names }), { ok: true });
});

Deno.test('spoken check › Telugu/Hindi: an English-letter word not in the reply is refused', () => {
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Suresh కి 5,000 రూపాయలు.', te), 'name');
  const hi = { source: HI_SOURCE, language: 'hi' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh को 5,000 रुपये, Kumar जी।', hi), 'name');
});

Deno.test('spoken check › allowlisted words pass in Telugu and Hindi', () => {
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  const say = 'Srinivas garu, Ramesh credit balance pending due overdue OK voice note call ' +
    'payment card Menu Remind insights dashboard Asha rupees Edit Cancel Save ji చూడండి.';
  assertEquals(reasonOf(say, te), 'ok');
});

Deno.test('spoken check › English: a capitalised word mid-sentence not in the reply is refused', () => {
  assertEquals(reasonOf('Ramesh and Kumar owe 5,000 rupees.', en()), 'name');
  assertEquals(reasonOf('So Ramesh owes 5,000 rupees.', en()), 'ok');
  assertEquals(reasonOf('Done. Lovely, Ramesh owes 5,000 rupees! Great work.', en()), 'ok');
  assertEquals(reasonOf("OK Srinivas, I'll note it. Tap Save on Sunday.", en()), 'ok');
});

Deno.test('spoken check › a reply with no English letters: any English-letter word is new', () => {
  const hi = { source: 'बाकी: ₹500', language: 'hi' as const, names: [] };
  assertEquals(reasonOf('Srinivas जी, 500 रुपये बाकी।', hi), 'ok');
  assertEquals(reasonOf('Ramesh पर 500 रुपये बाकी।', hi), 'name');
});

Deno.test('spoken check › capitalised words that are in the reply (any case) pass', () => {
  const source = 'Due alert\n1. Latha · ₹2,000\nRemind Latha';
  assertEquals(reasonOf('Srinivas, LATHA owes 2,000 rupees, tap Remind Latha.', en(source)), 'ok');
});

// ---- Tests — Build A (tester): adversarial cases ----

const LOOKUP_EN =
  '👤 *Ramesh*\n\nRamesh (Ramesh Kirana)\nBalance: ₹8,000\nOverdue: ₹3,000 · 5 days';
const LOOKUP_TE = 'Ramesh (Ramesh Kirana)\nబాకీ: ₹8,000\nఆలస్యం: ₹3,000 · 5 రోజులు';
const LOOKUP_HI = 'Ramesh (Ramesh Kirana)\nबाकी: ₹8,000\nबकाया: ₹3,000 · 5 दिन';

Deno.test('spoken check › a scale word glued to a digit still hides a figure (EN, HI, TE)', () => {
  // "5 days" is in the reply, so only the scale word can catch "5thousand" = 5,000.
  assertEquals(reasonOf('Ramesh owes 5thousand rupees.', en(LOOKUP_EN)), 'number_word');
  assertEquals(reasonOf('Ramesh owes 5lakh.', en(LOOKUP_EN)), 'number_word');
  const hi = { source: LOOKUP_HI, language: 'hi' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh पर 5हज़ार रुपये।', hi), 'number_word');
  const te = { source: LOOKUP_TE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh కి 5వేలు రూపాయలు.', te), 'number_word');
  assertEquals(reasonOf('Ramesh కి ౫వేలు రూపాయలు.', te), 'number_word');
});

Deno.test('spoken check › short Indian scale words: k, lac, lacs', () => {
  for (const say of ['Ramesh owes 5k.', 'Ramesh owes 5 K rupees.', 'About 5 lac.', '5 lacs.']) {
    assertEquals(reasonOf(say, en(LOOKUP_EN)), 'number_word', say);
  }
});

Deno.test('spoken check › a wrong figure hidden mid-sentence is caught', () => {
  const say = 'Ramesh owes 8,000 rupees, 3,000 of it late by 5 days, and 500 more next week.';
  assertEquals(reasonOf(say, en(LOOKUP_EN)), 'number');
  assertEquals(reasonOf('Ramesh owes 8,000 rupees, 3,000 late by 5 days.', en(LOOKUP_EN)), 'ok');
});

Deno.test('spoken check › Indian and international grouping and decimals', () => {
  assertEquals(reasonOf('In all 184,000 rupees.', en('Total ₹1,84,000')), 'ok');
  assertEquals(reasonOf('Ramesh owes 8000.00 rupees.', en(LOOKUP_EN)), 'ok');
  // "8.000" is 8, not 8,000: the reply has no 8 on its own.
  assertEquals(reasonOf('Ramesh owes 8.000 rupees.', en(LOOKUP_EN)), 'number');
});

Deno.test('spoken check › mixed digit scripts are one number; a wrong one in Hindi digits fails', () => {
  const te = { source: LOOKUP_TE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh కి ౮,000 రూపాయలు బాకీ.', te), 'ok');
  const hi = { source: LOOKUP_HI, language: 'hi' as const, names: NAMES };
  assertEquals(reasonOf('Ramesh पर ७ दिन से बकाया।', hi), 'number');
});

Deno.test('spoken check › a ₹ sign or an emoji does not hide a figure from the check', () => {
  assertEquals(reasonOf('Ramesh owes ₹6,000 📒.', en(LOOKUP_EN)), 'number');
  assertEquals(reasonOf('Ramesh owes ₹8,000 📒.', en(LOOKUP_EN)), 'ok');
});

Deno.test('spoken check › links in any case, and before the script check', () => {
  assertEquals(reasonOf('Open WWW.example.in', en()), 'link');
  assertEquals(reasonOf('Open HTTPS://x.example', en()), 'link');
  const te = { source: TE_SOURCE, language: 'te' as const, names: NAMES };
  assertEquals(reasonOf('ఇక్కడ చూడండి www.x.in', te), 'link');
});

Deno.test('spoken check › exactly 600 characters pass, 601 fail; spaces around do not count', () => {
  assertEquals(reasonOf('a'.repeat(MAX_SPOKEN_CHARS), en()), 'ok');
  assertEquals(reasonOf('a'.repeat(MAX_SPOKEN_CHARS + 1), en()), 'too_long');
  assertEquals(reasonOf(`\n  ${'a'.repeat(MAX_SPOKEN_CHARS)}\t `, en()), 'ok');
  assertEquals(reasonOf('\n\t \r\n', en()), 'bad_json');
});
