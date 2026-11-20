// supabase/functions/_shared/calls/tone-judge.test.ts
import { assert, assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { scoreMunshiCall } from './munshi-scorecard.ts';
import {
  buildTonePrompt,
  createToneJudge,
  type ToneJudgement,
  toneMessage,
  withTone,
} from './tone-judge.ts';

const TURNS: readonly Turn[] = [
  { role: 'assistant', content: 'Haa Srinivas anna, Munshi. Cheppandi.' },
  { role: 'user', content: 'How much does Ramesh owe?' },
];

function geminiReply(text: string): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
        status: 200,
      }),
    );
}

function judgeWith(fetchImpl: typeof fetch): {
  judge: ReturnType<typeof createToneJudge>;
  logs: LogFields[];
} {
  const logs: LogFields[] = [];
  const log = (_level: string, _event: string, fields: LogFields = {}): void => {
    logs.push(fields);
  };
  return {
    judge: createToneJudge({ sarvamApiKey: '', geminiApiKey: 'test', fetchImpl, log }),
    logs,
  };
}

const JUDGED: ToneJudgement = {
  version: 'v1',
  model: 'gemini-2.5-flash',
  points: [
    { id: 'friendly', score: 5, reason: '' },
    { id: 'language_match', score: 4, reason: '' },
    { id: 'clear', score: 2, reason: 'Read out 10 names in one turn.' },
  ],
};

Deno.test('tone judge › the prompt names the agent and its points; the message is spoken words', () => {
  const prompt = buildTonePrompt('munshi');
  assert(prompt.includes("MUNSHI's lines"));
  assert(prompt.includes('- on_point:'));
  assert(buildTonePrompt('asha').includes('- no_pressure:'));
  assertEquals(
    toneMessage('munshi', TURNS),
    'MUNSHI: Haa Srinivas anna, Munshi. Cheppandi.\nOWNER: How much does Ramesh owe?',
  );
});

Deno.test('tone judge › a good answer is kept with its version and model; a bad one is null', async () => {
  const good = judgeWith(geminiReply('{"points":[{"id":"clear","score":4,"reason":"ok"}]}'));
  const judged = await good.judge('munshi', TURNS);
  assertEquals(judged?.points[0]?.score, 4);
  assertEquals(judged?.version, 'v1');
  const bad = judgeWith(geminiReply('not json'));
  assertEquals(await bad.judge('munshi', TURNS), null);
  const down = judgeWith(() => Promise.reject(new Error('offline')));
  assertEquals(await down.judge('munshi', TURNS), null);
  assertEquals(await good.judge('munshi', []), null);
});

Deno.test('tone judge › low scores warn, never fail; a point not judged is n/a', () => {
  const card = withTone(
    scoreMunshiCall({
      startedAt: '2026-11-20T05:00:00Z',
      durationSeconds: 60,
      transcript: [...TURNS],
      tools: [],
      steps: [],
    }),
    'munshi',
    JUDGED,
  );
  const tone = card.groups.find((group) => group.name === 'Tone')?.checks ?? [];
  assertEquals(tone.map((one) => one.status), ['pass', 'pass', 'warn', 'na']);
  assertEquals(tone[2]?.value, '2/5 · Read out 10 names in one turn.');
  assert(card.verdict !== 'failed');
  const none = withTone(
    scoreMunshiCall({
      startedAt: '2026-11-20T05:00:00Z',
      durationSeconds: 60,
      transcript: null,
      tools: [],
      steps: [],
    }),
    'munshi',
    null,
  );
  assert(
    none.groups.find((group) => group.name === 'Tone')?.checks.every((one) => one.status === 'na'),
  );
});
