// supabase/functions/_shared/speech/translate.test.ts
// Live Translate (M6 Decision 4): names and amounts pass through unchanged, a lost marker means
// "no translation", and failures never throw. Fake fetch only.
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { createTranslator, mask, SARVAM_TRANSLATE_URL, unmask } from './translate.ts';

const NAMES = ['Ramesh', 'Ramesh Kirana', 'Latha'];

interface Seen {
  url: string;
  body: Record<string, unknown>;
}

/** A fake Sarvam that "translates" by the function given (it sees the masked text). */
interface Harness {
  translate: ReturnType<typeof createTranslator>;
  seen: Seen[];
  logs: { event: string; fields: LogFields }[];
}

function translatorWith(
  answer: (input: string) => Response | Promise<Response>,
  mode?: 'modern-colloquial',
): Harness {
  const seen: Seen[] = [];
  const logs: { event: string; fields: LogFields }[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    seen.push({ url: String(input), body });
    return Promise.resolve(answer(String(body.input)));
  }
  const translate = createTranslator({
    apiKey: 'sk',
    fetchImpl: fakeFetch,
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
    ...(mode ? { mode } : {}),
  });
  return { translate, seen, logs };
}

function sarvamSays(text: string): Response {
  return Response.json({ translated_text: text, source_language_code: 'te-IN' });
}

Deno.test('translate › mask swaps names (longest first) and figures for markers', () => {
  const masked = mask('Ramesh Kirana ki ₹5,000 credit, 15th varaku. ramesh 2.5k', NAMES);
  assertEquals(masked.text, '⟦1⟧ ki ⟦3⟧ credit, ⟦4⟧ varaku. ⟦2⟧ ⟦5⟧');
  assertEquals(masked.values, ['Ramesh Kirana', 'ramesh', '₹5,000', '15th', '2.5k']);
});

Deno.test('translate › mask works on Telugu script around a name', () => {
  const masked = mask('Ramesh కి 5,000 క్రెడిట్', NAMES);
  assertEquals(masked.text, '⟦1⟧ కి ⟦2⟧ క్రెడిట్');
});

Deno.test('translate › a name inside a longer word is left alone', () => {
  assertEquals(mask('Lathamma paid', NAMES).text, 'Lathamma paid');
});

Deno.test('translate › unmask restores every marker, in any order', () => {
  assertEquals(
    unmask('Credit of ⟦2⟧ for ⟦1⟧', ['Ramesh', '₹5,000']),
    'Credit of ₹5,000 for Ramesh',
  );
});

Deno.test('translate › unmask refuses a lost, repeated or invented marker', () => {
  const values = ['Ramesh', '₹5,000'];
  assertEquals(unmask('Credit for ⟦1⟧', values), null);
  assertEquals(unmask('⟦1⟧ ⟦1⟧ ⟦2⟧', values), null);
  assertEquals(unmask('⟦1⟧ ⟦2⟧ ⟦3⟧', values), null);
});

Deno.test('translate › names and amounts come back exactly as written', async () => {
  const { translate, seen } = translatorWith((input) =>
    sarvamSays(input.replace('ki', 'gets').replace('credit', 'credit').replace('varaku', 'by'))
  );
  const english = await translate({
    text: 'Ramesh ki ₹1,84,000 credit, 15th varaku',
    from: 'te',
    to: 'en',
    keep: NAMES,
  });
  assertEquals(english, 'Ramesh gets ₹1,84,000 credit, 15th by');
  assertEquals(seen[0]?.url, SARVAM_TRANSLATE_URL);
  assertEquals(seen[0]?.body.input, '⟦1⟧ ki ⟦2⟧ credit, ⟦3⟧ varaku');
  assertEquals(seen[0]?.body.source_language_code, 'te-IN');
  assertEquals(seen[0]?.body.target_language_code, 'en-IN');
  assertEquals(seen[0]?.body.model, 'mayura:v1');
  assertEquals(seen[0]?.body.mode, 'code-mixed');
});

Deno.test('translate › Sarvam dropping a marker → null, logged without the text', async () => {
  const { translate, logs } = translatorWith(() => sarvamSays('credit given'));
  const result = await translate({ text: 'Ramesh 5000', from: 'te', to: 'en', keep: NAMES });
  assertEquals(result, null);
  assertEquals(logs[0]?.event, 'translate_marker_lost');
  assert(!JSON.stringify(logs).includes('Ramesh'));
});

Deno.test('translate › an HTTP error, bad body or timeout → null, never thrown', async () => {
  for (
    const answer of [
      () => new Response('busy', { status: 503 }),
      () => Response.json({ nothing: true }),
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      () => Promise.reject('not an Error'),
    ]
  ) {
    const { translate, logs } = translatorWith(answer);
    assertEquals(await translate({ text: 'hello', from: 'en', to: 'te', keep: [] }), null);
    assertEquals(logs[0]?.event, 'translate_failed');
  }
});

Deno.test('translate › same language or empty text is returned without a call', async () => {
  const { translate, seen } = translatorWith(() => sarvamSays('x'));
  assertEquals(await translate({ text: ' Hi ', from: 'en', to: 'en', keep: [] }), 'Hi');
  assertEquals(await translate({ text: '  ', from: 'te', to: 'en', keep: [] }), '');
  assertEquals(seen.length, 0);
});

Deno.test('translate › text over 1,000 characters is not sent', async () => {
  const { translate, seen, logs } = translatorWith(() => sarvamSays('x'));
  assertEquals(await translate({ text: 'a'.repeat(1001), from: 'te', to: 'en', keep: [] }), null);
  assertEquals(seen.length, 0);
  assertEquals(logs[0]?.event, 'translate_too_long');
});

Deno.test("translate › the wording style can be changed (Saim's choice)", async () => {
  const { translate, seen } = translatorWith(() => sarvamSays('నమస్తే'), 'modern-colloquial');
  await translate({ text: 'hello', from: 'en', to: 'te', keep: [] });
  assertEquals(seen[0]?.body.mode, 'modern-colloquial');
});
