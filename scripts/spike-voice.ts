// scripts/spike-voice.ts
// npm run spike:voice -- note1.ogg note2.ogg note3.ogg   (M6 piece 6a-1, run once on the laptop)
// Decides M6 Decisions 2 and 3 with real Sarvam calls, about ₹1 in total:
//   1. each voice note → Saaras three ways (v3 codemix, v3 translit, v4 + shopkeeper names) →
//      the transcripts side by side, plus the English from Sarvam Translate (code-mixed and
//      modern-colloquial wording), names and amounts protected;
//   2. three Bulbul samples of one reply line (v3 Kavitha in Telugu, v4-flash Kavitha in Telugu,
//      v3 Kavitha in Hindi) saved as MP3 files to listen to.
// Voice notes: record on WhatsApp and save them (WhatsApp Web → download), or any .ogg/.mp3 file
// under 30 s. Needs SARVAM_API_KEY in .env. Prints transcripts only, never the key. Thrown away
// after M6.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { logToConsole } from '../supabase/functions/_shared/log.ts';
import { createTranscriber, type SttConfig } from '../supabase/functions/_shared/speech/stt.ts';
import { createSpeaker } from '../supabase/functions/_shared/speech/tts.ts';
import {
  createTranslator,
  type TranslateMode,
} from '../supabase/functions/_shared/speech/translate.ts';
import { generateSeed } from './seed/generate-seed.ts';
import { requireEnv } from './lib/smoke.ts';

const OUT_DIR = 'spike-voice-out';

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}
const SAMPLE_TE = 'రమేష్ గారు ₹8,500 బాకీ ఉన్నారు. 12 రోజులు ఆలస్యం.';
const SAMPLE_HI = 'रमेश जी पर ₹8,500 बाकी है। 12 दिन की देरी है।';

const NAMES = generateSeed().shopkeepers.map((shopkeeper) => shopkeeper.name);

const STT_OPTIONS: ReadonlyArray<{ label: string; config: Partial<SttConfig> }> = [
  { label: 'v3 codemix (recommended)', config: { model: 'saaras:v3', mode: 'codemix' } },
  { label: 'v3 translit', config: { model: 'saaras:v3', mode: 'translit' } },
  {
    label: 'v4 + 50 names',
    config: { model: 'saaras:v4', mode: null, keyterms: NAMES.slice(0, 50) },
  },
];

function mimeOf(path: string): string {
  return path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
}

async function transcribeAll(path: string, apiKey: string): Promise<void> {
  const bytes = new Uint8Array(readFileSync(path));
  say(`\n=== ${basename(path)} (${bytes.length} bytes)`);
  for (const option of STT_OPTIONS) {
    const transcribe = createTranscriber({
      apiKey,
      fetchImpl: fetch,
      log: logToConsole,
      ...option.config,
    });
    const result = await transcribe({ bytes, mimeType: mimeOf(path) });
    const shown = result.kind === 'heard' ? `[${result.language}] ${result.text}` : result.kind;
    say(`  ${option.label.padEnd(26)} ${shown}`);
    if (option.label.startsWith('v3 codemix') && result.kind === 'heard') {
      await translateBoth(result.text, result.language, apiKey);
    }
  }
}

async function translateBoth(
  text: string,
  from: 'te' | 'hi' | 'en',
  apiKey: string,
): Promise<void> {
  if (from === 'en') return;
  for (const mode of ['code-mixed', 'modern-colloquial'] satisfies TranslateMode[]) {
    const translate = createTranslator({ apiKey, fetchImpl: fetch, log: logToConsole, mode });
    const english = await translate({ text, from, to: 'en', keep: NAMES });
    say(`  ${`→ English (${mode})`.padEnd(26)} ${english ?? '(translation refused)'}`);
  }
}

async function voiceSamples(apiKey: string): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const samples = [
    { file: '1-v3-kavitha-te.mp3', model: 'bulbul:v3', speaker: 'kavitha', text: SAMPLE_TE },
    {
      file: '2-v4flash-kavitha-te.mp3',
      model: 'bulbul:v4-flash',
      speaker: 'kavitha_te_conversation',
      text: SAMPLE_TE,
    },
    { file: '3-v3-kavitha-hi.mp3', model: 'bulbul:v3', speaker: 'kavitha', text: SAMPLE_HI },
  ] as const;
  say(`\n=== Bulbul samples → ${OUT_DIR}/`);
  for (const sample of samples) {
    const speak = createSpeaker({ apiKey, fetchImpl: fetch, log: logToConsole, ...sample });
    const language = sample.text === SAMPLE_HI ? 'hi' : 'te';
    const mp3 = await speak(sample.text.replace('₹8,500', '8,500'), language);
    if (mp3) writeFileSync(join(OUT_DIR, sample.file), mp3);
    say(`  ${sample.file.padEnd(26)} ${mp3 ? `${mp3.length} bytes` : 'failed'}`);
  }
}

async function main(): Promise<void> {
  const apiKey = requireEnv('SARVAM_API_KEY');
  const files = process.argv.slice(2);
  if (files.length === 0) say('No voice notes given: only the Bulbul samples are made.');
  for (const file of files) await transcribeAll(file, apiKey);
  await voiceSamples(apiKey);
}

await main();
