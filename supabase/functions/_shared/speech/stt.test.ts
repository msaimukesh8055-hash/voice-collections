// supabase/functions/_shared/speech/stt.test.ts
// Saaras speech-to-text (M6): the request Sarvam gets, the language mapping, and safe failures.
// Fake fetch only.
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { createTranscriber, languageOf, SARVAM_STT_URL, type SttConfig } from './stt.ts';

const AUDIO = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg; codecs=opus' };

interface Harness {
  transcribe: ReturnType<typeof createTranscriber>;
  forms: FormData[];
  urls: string[];
  logs: { event: string; fields: LogFields }[];
}

function harness(
  reply: () => Response | Promise<Response>,
  overrides: Partial<SttConfig> = {},
): Harness {
  const forms: FormData[] = [];
  const urls: string[] = [];
  const logs: { event: string; fields: LogFields }[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    urls.push(String(input));
    forms.push(init?.body as FormData);
    return Promise.resolve(reply());
  }
  const transcribe = createTranscriber({
    apiKey: 'sk',
    fetchImpl: fakeFetch,
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
    ...overrides,
  });
  return { transcribe, forms, urls, logs };
}

Deno.test('stt › sends the voice note as it is, with saaras:v3 translit and auto language', async () => {
  const { transcribe, forms, urls } = harness(() =>
    Response.json({ transcript: 'Ramesh కి 5,000 credit', language_code: 'te-IN' })
  );
  const result = await transcribe(AUDIO);
  assertEquals(result, { kind: 'heard', text: 'Ramesh కి 5,000 credit', language: 'te' });
  assertEquals(urls[0], SARVAM_STT_URL);
  const form = forms[0];
  assertEquals(form?.get('model'), 'saaras:v3');
  assertEquals(form?.get('mode'), 'translit');
  assertEquals(form?.get('language_code'), 'unknown');
  assertEquals((form?.get('file') as File).type, 'audio/ogg');
  assertEquals(form?.get('keyterms'), null);
});

Deno.test('stt › the spike can try v4 with names to listen for and no mode', async () => {
  const names = Array.from({ length: 60 }, (_, i) => `Name${i}`);
  const { transcribe, forms } = harness(() => Response.json({ transcript: 'x' }), {
    model: 'saaras:v4',
    mode: null,
    keyterms: names,
  });
  await transcribe({ ...AUDIO, mimeType: '' });
  assertEquals(forms[0]?.get('model'), 'saaras:v4');
  assertEquals(forms[0]?.get('mode'), null);
  assertEquals(JSON.parse(String(forms[0]?.get('keyterms'))).length, 50);
  assertEquals((forms[0]?.get('file') as File).type, 'audio/ogg');
});

Deno.test('stt › language codes map to the reply language', () => {
  assertEquals(languageOf('te-IN'), 'te');
  assertEquals(languageOf('hi-IN'), 'hi');
  assertEquals(languageOf('en-IN'), 'en');
  assertEquals(languageOf('ta-IN'), 'en');
  assertEquals(languageOf(null), 'en');
  assertEquals(languageOf(undefined), 'en');
});

Deno.test('stt › silence gives "empty"', async () => {
  const { transcribe } = harness(() => Response.json({ transcript: '  ', language_code: null }));
  assertEquals(await transcribe(AUDIO), { kind: 'empty' });
});

Deno.test('stt › HTTP error, bad body, timeout → "failed", logged without the audio', async () => {
  for (
    const reply of [
      () => new Response('quota', { status: 429 }),
      () => Response.json({ wrong: true }),
      () => Promise.reject(new DOMException('slow', 'TimeoutError')),
      () => Promise.reject('odd'),
    ]
  ) {
    const { transcribe, logs } = harness(reply);
    assertEquals(await transcribe(AUDIO), { kind: 'failed' });
    assertEquals(logs[0]?.event, 'stt_failed');
    assert(!JSON.stringify(logs).includes('Ramesh'));
  }
});
