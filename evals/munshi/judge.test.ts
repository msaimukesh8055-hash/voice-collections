// evals/munshi/judge.test.ts
// The eval judge (M8 C1): prompt names the owner's language and scores Munshi only; the answer
// is checked (1–5 integers); a bad answer or a failed call gives no score and logs no text.
import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../../supabase/functions/_shared/llm/json-llm.ts';
import {
  buildJudgePrompt,
  judgeConversation,
  judgeMessage,
  JUDGE_PROMPT_VERSION,
} from './judge.ts';

const TRANSCRIPT = [
  { role: 'assistant' as const, content: 'హా Srinivas అన్నా' },
  { role: 'user' as const, content: 'ఎంత బాకీ ఉంది?' },
];

function judgeAnswering(
  answer: string | Error,
  seen: ChatRequest[] = [],
): { name: 'gemini'; ask: (request: ChatRequest) => Promise<string> } {
  return {
    name: 'gemini',
    ask(request): Promise<string> {
      seen.push(request);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

describe('judge', () => {
  it('names the language and the three scores; transcript as MUNSHI / OWNER lines', () => {
    expect(buildJudgePrompt('te')).toContain('Srinivas mostly speaks Telugu.');
    expect(buildJudgePrompt('hi')).toContain(
      '"casual": 1-5, "language_match": 1-5, "clarity": 1-5',
    );
    expect(judgeMessage(TRANSCRIPT)).toBe('MUNSHI: హా Srinivas అన్నా\nOWNER: ఎంత బాకీ ఉంది?');
    expect(JUDGE_PROMPT_VERSION).toBe('v1');
  });

  it('returns checked scores from a fenced answer', async () => {
    const seen: ChatRequest[] = [];
    const answer = '```json\n{"casual": 5, "language_match": 4, "clarity": 4, "note": "ok"}\n```';
    const scores = await judgeConversation(
      judgeAnswering(answer, seen),
      { language: 'te', transcript: TRANSCRIPT },
      vi.fn(),
    );
    expect(scores).toEqual({ casual: 5, language_match: 4, clarity: 4, note: 'ok' });
    expect(seen[0]?.messages[0]?.content).toContain('OWNER: ఎంత బాకీ ఉంది?');
  });

  it('a missing note is empty; an out-of-range score or a failure gives null and logs the outcome only', async () => {
    const noNote = await judgeConversation(
      judgeAnswering('{"casual": 3, "language_match": 3, "clarity": 3}'),
      { language: 'en', transcript: [] },
      vi.fn(),
    );
    expect(noNote?.note).toBe('');
    const log = vi.fn();
    const outOfRange = await judgeConversation(
      judgeAnswering('{"casual": 6, "language_match": 3, "clarity": 3}'),
      { language: 'en', transcript: [] },
      log,
    );
    const failed = await judgeConversation(
      judgeAnswering(new Error('HTTP 429')),
      { language: 'en', transcript: [] },
      log,
    );
    expect([outOfRange, failed]).toEqual([null, null]);
    expect(log.mock.calls.map((call) => call[2])).toEqual([
      { provider: 'gemini', outcome: 'bad_json' },
      { provider: 'gemini', outcome: 'Error' },
    ]);
  });
});
