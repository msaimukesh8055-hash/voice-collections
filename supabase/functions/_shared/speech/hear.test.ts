// supabase/functions/_shared/speech/hear.test.ts
// One voice note → what was said, or why not; every refusal happens before Saaras is paid.
import { assertEquals } from '@std/assert';
import { voiceNote } from '../audio/__fixtures__/ogg-files.ts';
import type { Download } from '../whatsapp/media.ts';
import { DAILY_VOICE_CAP, hear, type HearDeps } from './hear.ts';
import type { Transcription } from './stt.ts';

const HEARD: Transcription = { kind: 'heard', text: 'Ramesh 5000', language: 'te' };

function deps(download: Download, count = 1): HearDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    countToday: () => Promise.resolve(count),
    download: (mediaId) => {
      calls.push(`download:${mediaId}`);
      return Promise.resolve(download);
    },
    transcribe: () => {
      calls.push('saaras');
      return Promise.resolve(HEARD);
    },
  };
}

const OK = (seconds: number): Download => ({
  kind: 'ok',
  bytes: voiceNote(seconds),
  mimeType: 'audio/ogg; codecs=opus',
});

Deno.test('hear › a short voice note goes to Saaras and gives the transcript', async () => {
  const d = deps(OK(10));
  assertEquals(await hear('M1', d), HEARD);
  assertEquals(d.calls, ['download:M1', 'saaras']);
});

Deno.test('hear › exactly 30 s is allowed; 30.1 s is refused without Saaras', async () => {
  assertEquals((await hear('M', deps(OK(30)))).kind, 'heard');
  const long = deps(OK(30.1));
  assertEquals(await hear('M', long), { kind: 'too_long' });
  assertEquals(long.calls, ['download:M']);
});

Deno.test('hear › too big, failed download or not Ogg/Opus → refused without Saaras', async () => {
  const notVoice: Download = { kind: 'ok', bytes: new Uint8Array(40), mimeType: 'audio/mpeg' };
  for (
    const [download, kind] of [
      [{ kind: 'too_big' }, 'too_big'],
      [{ kind: 'failed' }, 'failed'],
      [notVoice, 'not_voice'],
    ] as const
  ) {
    const d = deps(download);
    assertEquals(await hear('M', d), { kind });
    assertEquals(d.calls.includes('saaras'), false);
  }
});

Deno.test('hear › past the daily cap nothing is downloaded or transcribed', async () => {
  const atCap = deps(OK(5), DAILY_VOICE_CAP);
  assertEquals((await hear('M', atCap)).kind, 'heard');
  const over = deps(OK(5), DAILY_VOICE_CAP + 1);
  assertEquals(await hear('M', over), { kind: 'cap' });
  assertEquals(over.calls, []);
});
