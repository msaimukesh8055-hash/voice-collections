// supabase/functions/_shared/simulator/moves.test.ts
// LLM output validation for simulated calls (100%): defaults, junk, empty answers, long texts.
import { assertEquals } from '@std/assert';
import { MAX_TURN_CHARS } from '../sarvam-analytics.ts';
import { parseAshaMove, parseShopkeeperMove } from './moves.ts';

Deno.test('moves › Asha: a full move, and defaults for missing fields', () => {
  assertEquals(
    parseAshaMove(
      '```json\n{"say":"Hi","tool":{"name":"get_dues","args":{}},"end_call":false}\n```',
    ),
    { say: 'Hi', tool: { name: 'get_dues', args: {} }, end_call: false },
  );
  assertEquals(parseAshaMove('{"say":"Hi"}'), { say: 'Hi', tool: null, end_call: false });
  assertEquals(parseAshaMove('{"tool":{"name":"get_dues","args":"bad"}}'), {
    say: '',
    tool: { name: 'get_dues', args: {} },
    end_call: false,
  });
});

Deno.test('moves › Asha: nothing to say and no tool, or broken JSON, is unusable', () => {
  for (const content of ['{}', '{"say":"  "}', '  ', '{"tool":{"name":""}}', '{"say": "Hi"']) {
    assertEquals(parseAshaMove(content), null, content);
  }
});

Deno.test('moves › Asha: plain words without JSON are what she says (sarvam-105b after a tool)', () => {
  assertEquals(parseAshaMove(' Your total is 6,000 rupees. '), {
    say: 'Your total is 6,000 rupees.',
    tool: null,
    end_call: false,
  });
  assertEquals(parseAshaMove('a'.repeat(MAX_TURN_CHARS + 5))?.say.length, MAX_TURN_CHARS);
});

Deno.test('moves › shopkeeper: say is required; hang_up defaults to false; long text is cut', () => {
  assertEquals(parseShopkeeperMove('{"say":"Yes"}'), { say: 'Yes', hang_up: false });
  assertEquals(parseShopkeeperMove('{"say":"Bye","hang_up":true}'), { say: 'Bye', hang_up: true });
  assertEquals(parseShopkeeperMove('{"say":""}'), null);
  assertEquals(parseShopkeeperMove('{"hang_up":true}'), null);
  const long = parseShopkeeperMove(JSON.stringify({ say: 'a'.repeat(MAX_TURN_CHARS + 5) }));
  assertEquals(long?.say.length, MAX_TURN_CHARS);
});
