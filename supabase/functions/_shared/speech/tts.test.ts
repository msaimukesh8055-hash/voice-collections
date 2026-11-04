// supabase/functions/_shared/speech/tts.test.ts
// Bulbul voice replies (M6): the request, MP3 bytes back, and failures that never throw.
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { createSpeaker, MAX_TTS_CHARS, SARVAM_TTS_URL, type TtsConfig } from './tts.ts';

interface Harness {
  speak: ReturnType<typeof createSpeaker>;
  bodies: Record<string, unknown>[];
  urls: string[];
  logs: { event: string; fields: LogFields }[];
}

function harness(
  reply: () => Response | Promise<Response>,
  overrides: Partial<TtsConfig> = {},
): Harness {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const logs: { event: string; fields: LogFields }[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    urls.push(String(input));
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(reply());
  }
  const speak = createSpeaker({
    apiKey: 'sk',
    fetchImpl: fakeFetch,
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
    ...overrides,
  });
  return { speak, bodies, urls, logs };
}

const MP3 = btoa(String.fromCharCode(0x49, 0x44, 0x33, 4));

Deno.test('tts › asks Bulbul v3 (Kavitha) for MP3 in the reply language', async () => {
  const { speak, bodies, urls } = harness(() => Response.json({ audios: [MP3] }));
  const bytes = await speak(' Ramesh owes 8,500 rupees. ', 'te');
  assertEquals(bytes, new Uint8Array([0x49, 0x44, 0x33, 4]));
  assertEquals(urls[0], SARVAM_TTS_URL);
  assertEquals(bodies[0], {
    text: 'Ramesh owes 8,500 rupees.',
    target_language_code: 'te-IN',
    model: 'bulbul:v3',
    speaker: 'kavitha',
    output_audio_codec: 'mp3',
  });
});

Deno.test('tts › the spike can switch model and voice; long text is cut to 2,500', async () => {
  const { speak, bodies } = harness(() => Response.json({ audios: [MP3] }), {
    model: 'bulbul:v4-flash',
    speaker: 'kavitha_te_conversation',
  });
  await speak('a'.repeat(3000), 'hi');
  assertEquals([bodies[0]?.model, bodies[0]?.speaker], [
    'bulbul:v4-flash',
    'kavitha_te_conversation',
  ]);
  assertEquals(String(bodies[0]?.text).length, MAX_TTS_CHARS);
});

Deno.test('tts › nothing to say → no call', async () => {
  const { speak, urls } = harness(() => Response.json({ audios: [MP3] }));
  assertEquals(await speak('   ', 'en'), null);
  assertEquals(urls.length, 0);
});

Deno.test('tts › HTTP error, bad body, timeout → null, logged without the text', async () => {
  for (
    const reply of [
      () => new Response('bad', { status: 400 }),
      () => Response.json({ audios: [] }),
      () => Promise.reject(new DOMException('slow', 'TimeoutError')),
      () => Promise.reject('odd'),
    ]
  ) {
    const { speak, logs } = harness(reply);
    assertEquals(await speak('Ramesh 500', 'en'), null);
    assertEquals(logs[0]?.event, 'tts_failed');
    assert(!JSON.stringify(logs).includes('Ramesh'));
  }
});
