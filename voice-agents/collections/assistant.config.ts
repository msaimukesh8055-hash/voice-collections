// voice-agents/collections/assistant.config.ts
// Collections voice agent configuration.
// M2: real tools with a temporary test prompt; the full prompt framework (persona, objectives,
// constraints, few-shots) is written in M3 and reviewed by Saim.
import type { AgentConfig } from '../schema.ts';
import { LANGUAGE_VARIANTS } from './language-settings.ts';
import { M2_TEST_PROMPT } from './test-prompt.ts';
import { COLLECTIONS_TOOLS } from './tools.ts';

export const collectionsAgent: AgentConfig = {
  name: 'suvidha-collections',
  // Non-reasoning model: replies start in about 1 s. Vapi picks backup models automatically.
  model: { provider: 'openai', model: 'gpt-4.1-mini' },
  systemPrompt: M2_TEST_PROMPT,
  tools: COLLECTIONS_TOOLS,
  variants: LANGUAGE_VARIANTS,
  defaultVariant: 'en',
  // Barge-in: stop speaking as soon as the caller talks for 0.2 s, then wait 1 s before resuming.
  interruption: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 },
  idleTimeoutSeconds: 8,
  // Credit guard: no call runs past 4 minutes, demo day included. Saim's decision: 2 minutes in M1,
  // raised to 4 in M2 after a full call (verify → dispute → promise) was cut off at 2:05.
  maxDurationSeconds: 240,
};
