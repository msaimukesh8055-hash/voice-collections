// agent/collections/assistant.config.ts
// Collections voice agent — M1 spike configuration.
// The system prompt here is a placeholder for the voice test only; the full prompt
// framework (persona, objectives, constraints, few-shots) is written in M3 and reviewed by Saim.
import type { AgentConfig } from '../schema.ts';
import { LANGUAGE_VARIANTS } from './language-settings.ts';

const SPIKE_SYSTEM_PROMPT = `You are Asha, a polite AI voice assistant for Suvidha Finance, an Indian lending company.
This is a short TEST call to check voice quality. You do not have any customer or loan information yet.
- Keep every reply to one or two short sentences, suitable for speaking aloud.
- Reply in the same language the caller uses: English, Hindi, or Hinglish (mixed).
- Chat naturally about how they are and whether they can hear you clearly.
- Never mention amounts, loans or dues. If asked, say this is only a test call.
- If the caller says goodbye, thank them and end politely.`;

export const collectionsAgent: AgentConfig = {
  name: 'suvidha-collections',
  // Non-reasoning model: replies start in about 1 s. Vapi picks backup models automatically.
  model: { provider: 'openai', model: 'gpt-4.1-mini' },
  systemPrompt: SPIKE_SYSTEM_PROMPT,
  variants: LANGUAGE_VARIANTS,
  defaultVariant: 'en',
  // Barge-in: stop speaking as soon as the caller talks for 0.2 s, then wait 1 s before resuming.
  interruption: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 },
  idleTimeoutSeconds: 8,
  // Credit guard for the spike: no test call can run past 2 minutes.
  maxDurationSeconds: 120,
};
