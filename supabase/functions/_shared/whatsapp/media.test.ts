// supabase/functions/_shared/whatsapp/media.test.ts
// Meta media download and upload (M6), with a fake fetch only.
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { GRAPH_API_BASE } from './client.ts';
import { downloadMedia, MAX_VOICE_BYTES, type MediaConfig, uploadMedia } from './media.ts';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

interface Harness {
  config: MediaConfig;
  seen: Seen[];
  logs: { event: string; fields: LogFields }[];
}

function configWith(...replies: Array<() => Response | Promise<Response>>): Harness {
  const seen: Seen[] = [];
  const logs: { event: string; fields: LogFields }[] = [];
  const queue = [...replies];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    seen.push({ url: String(input), init });
    const next = queue.shift();
    return Promise.resolve(next ? next() : new Response(null, { status: 500 }));
  }
  const config: MediaConfig = {
    accessToken: 'TOKEN',
    phoneNumberId: '100000000000001',
    fetchImpl: fakeFetch,
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
  };
  return { config, seen, logs };
}

const INFO = { url: 'https://lookaside.example/voice', mime_type: 'audio/ogg; codecs=opus' };

Deno.test('media › a voice note is fetched in two steps, both with our token', async () => {
  const { config, seen } = configWith(
    () => Response.json({ ...INFO, file_size: 3 }),
    () => new Response(new Uint8Array([1, 2, 3])),
  );
  const result = await downloadMedia(config, 'MEDIA1');
  assertEquals(result, { kind: 'ok', bytes: new Uint8Array([1, 2, 3]), mimeType: INFO.mime_type });
  assertEquals(seen.map((s) => s.url), [`${GRAPH_API_BASE}/MEDIA1`, INFO.url]);
  for (const request of seen) {
    assertEquals((request.init?.headers as Record<string, string>).authorization, 'Bearer TOKEN');
  }
});

Deno.test('media › a file Meta says is over 1 MB is not downloaded', async () => {
  const { config, seen } = configWith(() =>
    Response.json({ ...INFO, file_size: MAX_VOICE_BYTES + 1 })
  );
  assertEquals(await downloadMedia(config, 'M'), { kind: 'too_big' });
  assertEquals(seen.length, 1);
});

Deno.test('media › a download bigger than 1 MB is refused even without a size', async () => {
  const { config } = configWith(
    () => Response.json(INFO),
    () => new Response(new Uint8Array(MAX_VOICE_BYTES + 1)),
  );
  assertEquals(await downloadMedia(config, 'M'), { kind: 'too_big' });
});

Deno.test('media › a Meta error or bad body is "failed", logged without the token', async () => {
  for (
    const replies of [
      [() => new Response('{}', { status: 401 })],
      [() => Response.json({ nope: 1 })],
      [() => Response.json(INFO), () => Promise.reject(new TypeError('network'))],
      [() => Promise.reject('odd')],
    ]
  ) {
    const { config, logs } = configWith(...replies);
    assertEquals(await downloadMedia(config, 'M'), { kind: 'failed' });
    assertEquals(logs[0]?.event, 'media_download_failed');
    assert(!JSON.stringify(logs).includes('TOKEN'));
  }
});

Deno.test('media › the HTTP status is logged when Meta refuses', async () => {
  const { config, logs } = configWith(() => new Response('{}', { status: 404 }));
  await downloadMedia(config, 'M');
  assertEquals(logs[0]?.fields.status, 404);
});

Deno.test('media › upload sends the file as multipart and returns the media id', async () => {
  const { config, seen } = configWith(() => Response.json({ id: 'UP1' }));
  const id = await uploadMedia(config, {
    bytes: new Uint8Array([9]),
    mimeType: 'audio/mpeg',
    fileName: 'reply.mp3',
  });
  assertEquals(id, 'UP1');
  assertEquals(seen[0]?.url, `${GRAPH_API_BASE}/100000000000001/media`);
  const form = seen[0]?.init?.body as FormData;
  assertEquals(form.get('messaging_product'), 'whatsapp');
  assertEquals(form.get('type'), 'audio/mpeg');
  assertEquals((form.get('file') as File).name, 'reply.mp3');
});

Deno.test('media › a failed upload gives null and a log line', async () => {
  for (const reply of [() => new Response('{}', { status: 400 }), () => Promise.reject('x')]) {
    const { config, logs } = configWith(reply);
    const file = { bytes: new Uint8Array([1]), mimeType: 'image/png', fileName: 'pie.png' };
    assertEquals(await uploadMedia(config, file), null);
    assertEquals(logs[0]?.event, 'media_upload_failed');
  }
});
