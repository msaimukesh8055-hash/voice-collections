// supabase/functions/_shared/simulator/munshi-text.test.ts
// Munshi in text evals (M8 C1): the approved prompt is used unchanged with every agent variable
// filled, the text-mode section and all 10 tools are added, the greeting is the live one.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { MUNSHI_PROMPT } from '../../../../voice-agents/munshi/prompt.ts';
import { OWNER_TOOL_NAMES } from '../owner-tools/schemas.ts';
import {
  fillAgentVariables,
  MUNSHI_SIMULATED_VERSION,
  munshiGreeting,
  munshiSystemPrompt,
  munshiTools,
  OWNER_LABEL,
} from './munshi-text.ts';

const VARIABLES = {
  ownerShortName: 'Srinivas',
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  today: 'Saturday, 2026-11-07',
};

Deno.test('munshi text › the approved prompt, every variable filled, then text mode', () => {
  const system = munshiSystemPrompt(VARIABLES);
  assertEquals(system.match(/\{\{\w+\}\}/g), null);
  assertStringIncludes(system, 'for Srinivas at Sri Lakshmi Traders');
  assertStringIncludes(system, 'Today is Saturday, 2026-11-07.');
  assert(system.startsWith(MUNSHI_PROMPT.slice(0, 30)));
  assertStringIncludes(system, `"${OWNER_LABEL}: ..."`);
});

Deno.test('munshi text › all 10 owner tools, listed and declared natively', () => {
  const system = munshiSystemPrompt(VARIABLES);
  for (const name of OWNER_TOOL_NAMES) assertStringIncludes(system, `- ${name}: `);
  const tools = munshiTools();
  assertEquals(tools.map((tool) => tool.name), [...OWNER_TOOL_NAMES]);
  assertEquals(tools.length, 10);
  assertStringIncludes(JSON.stringify(tools[0]?.parameters), '"focus"');
});

Deno.test('munshi text › greeting is the live Telugu one; version names prompt and text mode', () => {
  assertEquals(munshiGreeting(VARIABLES), 'హా Srinivas అన్నా, మున్షీని. చెప్పండి, ఏం చూడాలి?');
  assertEquals(MUNSHI_SIMULATED_VERSION, 'v1+text-v1');
});

Deno.test('munshi text › an unknown variable stays as written, never blank', () => {
  assertEquals(fillAgentVariables('{{a}} and {{b}}', { a: 'x' }), 'x and {{b}}');
});
