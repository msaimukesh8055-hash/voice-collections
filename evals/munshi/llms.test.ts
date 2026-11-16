// evals/munshi/llms.test.ts
// Eval model wiring (M8 C1): live = Munshi on sarvam-105b with tools and reasoning off, owner on
// Gemini then Sarvam, judge on Gemini, Gemini calls spaced out; keys only in headers. Dry fakes
// never touch the network. No real network here: fetch is a fake.
import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../../supabase/functions/_shared/llm/json-llm.ts';
import type { ChatProvider } from '../../supabase/functions/_shared/simulator/run.ts';
import {
  DRY_GOODBYE,
  dryModels,
  GEMINI_MIN_GAP_MS,
  liveModels,
  ownerLineAsJson,
  spacedOut,
} from './llms.ts';
import { MUNSHI_SCENARIOS } from './scenarios.ts';

const REQUEST: ChatRequest = {
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 50,
};

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function fakeFetch(sent: Sent[]): typeof fetch {
  return (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url, headers: init?.headers as Record<string, string>, body });
    const reply = url.includes('sarvam')
      ? { choices: [{ message: { content: '{"say":"ok"}' } }] }
      : { candidates: [{ content: { parts: [{ text: '{"say":"ok"}' }] } }] };
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
  };
}

describe('spacedOut', () => {
  it('starts calls at least the gap apart', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const pacing = {
      now: () => now,
      sleep: (ms: number): Promise<void> => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    };
    const spaced = spacedOut({ name: 'gemini', ask: () => Promise.resolve('x') }, 100, pacing);
    await spaced.ask(REQUEST);
    await spaced.ask(REQUEST);
    now += 500;
    await spaced.ask(REQUEST);
    expect(waits).toEqual([100]);
  });
});

describe('liveModels', () => {
  it('by default the owner and the judge are on Sarvam too (no Gemini quota)', async () => {
    const sent: Sent[] = [];
    const config = {
      sarvamApiKey: 'sk-test',
      geminiApiKey: '',
      fetchImpl: fakeFetch(sent),
      log: vi.fn(),
    };
    const models = liveModels(config, { now: () => 0, sleep: () => Promise.resolve() });
    await models.judge.ask(REQUEST);
    expect(models.owner.map((provider) => provider.name)).toEqual(['sarvam', 'sarvam']);
    expect(models.judge.name).toBe('sarvam');
    expect(sent[0]?.body).toMatchObject({ model: 'sarvam-105b' });
    expect(sent.some((request) => request.url.includes('googleapis'))).toBe(false);
  });

  it('with Gemini chosen: owner on Gemini with Sarvam fallback, judge on Gemini, keys in headers', async () => {
    const sent: Sent[] = [];
    const config = {
      sarvamApiKey: 'sk-test',
      geminiApiKey: 'gk-test',
      fetchImpl: fakeFetch(sent),
      log: vi.fn(),
    };
    const models = liveModels(config, { now: () => 0, sleep: () => Promise.resolve() }, 'gemini');
    await models.munshi.ask({
      ...REQUEST,
      tools: [{ name: 'book_summary', description: 'd', parameters: {} }],
    });
    await models.judge.ask(REQUEST);
    expect(models.owner.map((provider) => provider.name)).toEqual(['gemini', 'sarvam']);
    expect(sent[0]?.body).toMatchObject({ model: 'sarvam-105b', reasoning_effort: null });
    expect(sent[0]?.headers['api-subscription-key']).toBe('sk-test');
    expect(sent[1]?.headers['x-goog-api-key']).toBe('gk-test');
    expect(sent.some((request) => request.url.includes('gk-test'))).toBe(false);
    expect(GEMINI_MIN_GAP_MS).toBeGreaterThanOrEqual(6_000);
  });
});

describe('ownerLineAsJson', () => {
  function replying(text: string): ChatProvider {
    return { name: 'sarvam', ask: () => Promise.resolve(text) };
  }

  it('wraps a bare owner line as JSON', async () => {
    const reply = await ownerLineAsJson(replying(' Add 5000 credit for Ramesh. ')).ask(REQUEST);
    expect(JSON.parse(reply)).toEqual({ say: 'Add 5000 credit for Ramesh.', hang_up: false });
  });

  it('passes a JSON reply on untouched', async () => {
    const json = '{"say": "Ok bye.", "hang_up": true}';
    expect(await ownerLineAsJson(replying(json)).ask(REQUEST)).toBe(json);
  });

  it('an empty reply throws, so the next provider is tried', async () => {
    await expect(ownerLineAsJson(replying('  ')).ask(REQUEST)).rejects.toThrow('empty owner reply');
  });
});

describe('dryModels', () => {
  const scenario = MUNSHI_SCENARIOS[0];
  if (!scenario) throw new Error('no scenarios');

  it('fake owner says the scripted lines, then goodbye', async () => {
    const { owner } = dryModels(scenario);
    const first = await owner[0]?.ask({ ...REQUEST, messages: [] });
    const later = await owner[0]?.ask({
      ...REQUEST,
      messages: [{ role: 'assistant', content: 'x' }],
    });
    expect(JSON.parse(first ?? '{}').say).toBe(scenario.owner.scriptedLines[0]);
    expect(JSON.parse(later ?? '{}').say).toBe(DRY_GOODBYE);
  });

  it('fake Munshi: overview first, then the closing question, then bye after his goodbye; judge scores 4', async () => {
    const { munshi, judge } = dryModels(scenario);
    const first = JSON.parse(await munshi.ask(REQUEST));
    const afterTool = JSON.parse(
      await munshi.ask({
        ...REQUEST,
        messages: [{ role: 'tool', content: 'TOOL REPLY', toolCallId: 'c' }],
      }),
    );
    const bye = JSON.parse(
      await munshi.ask({
        ...REQUEST,
        messages: [{ role: 'user', content: `OWNER: ${DRY_GOODBYE}` }],
      }),
    );
    expect(first.tool).toEqual({ name: 'book_summary', args: { focus: 'overview' } });
    expect(afterTool.say).toBe('ఇంకేమైనా ఉందా అన్నా?');
    expect(bye.end_call).toBe(true);
    expect(JSON.parse(await judge.ask(REQUEST)).casual).toBe(4);
  });
});
