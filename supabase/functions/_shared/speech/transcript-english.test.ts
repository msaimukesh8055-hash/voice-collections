// supabase/functions/_shared/speech/transcript-english.test.ts
import { assertEquals } from '@std/assert';
import type { TranslateRequest } from './translate.ts';
import { englishLines, needsEnglish, scriptLanguage } from './transcript-english.ts';

const TURNS = [
  { role: 'assistant' as const, content: 'Namaste, Ramesh garu.' },
  { role: 'user' as const, content: 'సోమవారం 3,000 ఇస్తాను.' },
  { role: 'user' as const, content: 'सोमवार को दूँगा।' },
];

Deno.test('transcript english › only Telugu and Hindi script lines are translated', async () => {
  const asked: TranslateRequest[] = [];
  const lines = await englishLines(TURNS, (request) => {
    asked.push(request);
    return Promise.resolve(`EN:${request.from}`);
  }, ['Ramesh']);
  assertEquals(lines, [null, 'EN:te', 'EN:hi']);
  assertEquals(asked.map((r) => [r.to, r.keep]), [['en', ['Ramesh']], ['en', ['Ramesh']]]);
});

Deno.test('transcript english › which transcripts need it', () => {
  assertEquals(needsEnglish(TURNS), true);
  assertEquals(needsEnglish([TURNS[0]!]), false);
  assertEquals([scriptLanguage('abc'), scriptLanguage('తె'), scriptLanguage('हि')], [
    null,
    'te',
    'hi',
  ]);
});
