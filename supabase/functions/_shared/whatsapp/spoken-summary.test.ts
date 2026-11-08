// supabase/functions/_shared/whatsapp/spoken-summary.test.ts
// The spoken summary over a fake fetch and a fixed random (M7 A1-2): good JSON → the summary;
// anything else → exactly today's spokenText. Never Gemini, never the text in a log.
import { assert, assertEquals } from '@std/assert';
import type { LogFields, Logger } from '../log.ts';
import { SARVAM_CHAT_URL } from '../llm/json-llm.ts';
import type { Reply } from './replies.ts';
import { spokenText } from './spoken.ts';
import { OPENINGS, SPOKEN_PROMPT_VERSION } from './spoken-prompt.ts';
import { createSpokenSummarizer, SPOKEN_MAX_TOKENS, SPOKEN_TEMPERATURE } from './spoken-summary.ts';

const CARD: Reply = {
  kind: 'buttons',
  text: '🎤 Heard: “Ramesh 5000”\n\n🧾 *Add credit*\n\nRamesh (Ramesh Kirana)\n' +
    '₹5,000 · due Sun 15 Nov\n\nBalance after: ₹13,500',
  buttons: [{ id: 'a', title: 'Save' }, { id: 'b', title: 'Edit' }, { id: 'c', title: 'Cancel' }],
};
const GOOD = "Srinivas, I've got Ramesh down for 5,000 rupees, due Sunday 15 November. " +
  'That takes him to 13,500 rupees. Tap Save if it looks right.';
const NAMES = ['Srinivas Reddy', 'Ramesh', 'Ramesh Kirana', 'Imran'];
const INPUT = { replies: [CARD], language: 'en' as const, names: NAMES };

interface Seen {
  readonly urls: string[];
  readonly bodies: Array<Record<string, unknown>>;
  readonly logs: Array<{ event: string; fields: LogFields }>;
}

function sarvamBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

function setup(answer: () => Promise<Response>, random = 0): {
  summarize: ReturnType<typeof createSpokenSummarizer>;
  seen: Seen;
} {
  const seen: Seen = { urls: [], bodies: [], logs: [] };
  const fetchImpl: typeof fetch = (url, init) => {
    seen.urls.push(String(url));
    seen.bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return answer();
  };
  const log: Logger = (_level, event, fields = {}) => seen.logs.push({ event, fields });
  const summarize = createSpokenSummarizer({
    sarvamApiKey: 'test-key',
    fetchImpl,
    log,
    random: () => random,
  });
  return { summarize, seen };
}

function says(content: string): () => Promise<Response> {
  return () => Promise.resolve(new Response(sarvamBody(content), { status: 200 }));
}

const FLAT = spokenText([CARD], 'en');

Deno.test('summary › good JSON that passes the checks is spoken', async () => {
  const { summarize, seen } = setup(says(JSON.stringify({ say: GOOD })));
  assertEquals(await summarize(INPUT), GOOD);
  assertEquals(seen.logs.at(-1), {
    event: 'spoken_summary',
    fields: {
      outcome: 'ok',
      reason: null,
      ms: seen.logs.at(-1)?.fields.ms ?? -1,
      prompt: SPOKEN_PROMPT_VERSION,
    },
  });
});

Deno.test('summary › the request: Sarvam only, reasoning off, 0.7, 400 tokens, the picked opening', async () => {
  const { summarize, seen } = setup(says(JSON.stringify({ say: GOOD })), 0.99);
  await summarize(INPUT);
  assertEquals(seen.urls, [SARVAM_CHAT_URL]);
  const body = seen.bodies[0] ?? {};
  assertEquals(body.reasoning_effort, null);
  assertEquals([body.temperature, body.max_tokens], [SPOKEN_TEMPERATURE, SPOKEN_MAX_TOKENS]);
  assertEquals([SPOKEN_TEMPERATURE, SPOKEN_MAX_TOKENS], [0.7, 400]);
  const [system, user] = body.messages as Array<{ content: string }>;
  assert(system?.content.includes(OPENINGS[4]), 'last opening for random 0.99');
  assert(user?.content.includes('Buttons he can tap: Save, Edit, Cancel'), user?.content);
  assert(!user?.content.includes('Heard'), 'no Heard line for the LLM');
});

Deno.test('summary › a failed check → exactly spokenText; the reason is logged, not the text', async () => {
  const wrong = JSON.stringify({ say: 'Srinivas, Ramesh owes 6,000 rupees.' });
  const { summarize, seen } = setup(says(wrong));
  assertEquals(await summarize(INPUT), FLAT);
  const fields = seen.logs.at(-1)?.fields ?? {};
  assertEquals([fields.outcome, fields.reason], ['fallback', 'number']);
  assert(!JSON.stringify(seen.logs).includes('Ramesh'), 'no names in logs');
});

Deno.test('summary › bad JSON, no "say", HTTP error, timeout → spokenText', async () => {
  const cases: Array<[() => Promise<Response>, string]> = [
    [says('not json at all'), 'bad_json'],
    [says('{"text": "hello"}'), 'bad_json'],
    [() => Promise.resolve(new Response('{}', { status: 500 })), 'llm_failed'],
    [() => Promise.reject(new DOMException('timed out', 'TimeoutError')), 'llm_failed'],
  ];
  for (const [answer, reason] of cases) {
    const { summarize, seen } = setup(answer);
    assertEquals(await summarize(INPUT), FLAT, reason);
    assertEquals(seen.logs.at(-1)?.fields.reason, reason);
  }
});

Deno.test('summary › nothing to say → "" and no LLM call', async () => {
  const { summarize, seen } = setup(says('{}'));
  assertEquals(await summarize({ ...INPUT, replies: [{ kind: 'audio', mediaId: 'm' }] }), '');
  assertEquals(seen.urls.length, 0);
});

Deno.test('summary › the spoken text is trimmed', async () => {
  const { summarize } = setup(says(JSON.stringify({ say: `  ${GOOD}  ` })));
  assertEquals(await summarize(INPUT), GOOD);
});

// ---- Tests — Build A (tester): model output shapes and failure logs ----

Deno.test('summary › JSON in code fences or after a short preamble is still read', async () => {
  for (
    const content of [
      `\`\`\`json\n${JSON.stringify({ say: GOOD })}\n\`\`\``,
      `Here you go: ${JSON.stringify({ say: GOOD })} Hope that helps.`,
    ]
  ) {
    const { summarize, seen } = setup(says(content));
    assertEquals(await summarize(INPUT), GOOD, content);
    assertEquals(seen.logs.at(-1)?.fields.outcome, 'ok');
  }
});

Deno.test('summary › odd answers fall back with the right reason', async () => {
  const cases: Array<[() => Promise<Response>, string]> = [
    [says('{"say": 5000}'), 'bad_json'],
    [says('{"say": ""}'), 'bad_json'],
    [says('{"say": "a"} and {"say": "b"}'), 'bad_json'],
    [says('{"say": "Ramesh owes 5 thousand rupees."}'), 'number_word'],
    [says('{"say": "Open www.example.in, Srinivas."}'), 'link'],
    [() => Promise.resolve(new Response('{"oops": true}', { status: 200 })), 'llm_failed'],
    [() => Promise.resolve(new Response('not json', { status: 200 })), 'llm_failed'],
  ];
  for (const [answer, reason] of cases) {
    const { summarize, seen } = setup(answer);
    assertEquals(await summarize(INPUT), FLAT, reason);
    assertEquals(seen.logs.at(-1)?.fields.reason, reason);
  }
});

Deno.test('summary › no fallback log ever carries the summary, the reply or a name', async () => {
  const answers = [
    says(JSON.stringify({ say: 'Srinivas, Imran owes 5,000 rupees.' })),
    says('Ramesh Kirana nonsense'),
    () => Promise.resolve(new Response('Ramesh 13,500', { status: 500 })),
  ];
  for (const answer of answers) {
    const { summarize, seen } = setup(answer);
    await summarize(INPUT);
    const logged = JSON.stringify(seen.logs);
    for (const secret of ['Ramesh', 'Imran', 'Srinivas', '5,000', '13,500']) {
      assert(!logged.includes(secret), `${secret} in ${logged}`);
    }
    assertEquals(Object.keys(seen.logs.at(-1)?.fields ?? {}).sort(), [
      'ms',
      'outcome',
      'prompt',
      'reason',
    ]);
  }
});
