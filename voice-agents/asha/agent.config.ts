// voice-agents/asha/agent.config.ts
// Asha — Easy Recovery: the reminder voice agent on Sarvam (SPEC §7, M3 Decisions 10–11).
// Source of truth for what is pushed to Sarvam (npm run agent:build renders it).
import { CALL_TOKEN_VARIABLE } from '../../supabase/functions/_shared/sarvam.ts';
import { type AgentConfig, MAX_CALL_SECONDS } from '../schema.ts';
import { GREETINGS } from './greetings.ts';
import { ASHA_PROMPT } from './prompt.ts';
import { ASHA_TOOLS } from './tools.ts';

/** Sarvam Bulbul "Kavitha – Conversational", a female Telugu voice (SPEC D4). */
const KAVITHA_VOICE_ID = '01a0cf16-897b-76f8-8de9-34f27e861df6';

/** Name of the bearer secret in Sarvam's Secrets vault; its value is SARVAM_TOOL_SECRET. */
export const TOOL_SECRET_NAME = 'easy-recovery-tool-secret';

export const ashaAgent: AgentConfig = {
  name: 'Asha-Easy-Recovery', // Sarvam allows only letters, numbers, spaces, _ and -
  description:
    'Reminder calls for Sri Lakshmi Traders (fake prototype): identity first, dues from tools, ' +
    'one promise per call (latest terms win), payment claims for the owner to confirm.',
  prompt: ASHA_PROMPT,
  // Telugu by default (Anantapur). The phone page also sends the greeting in the shopkeeper's
  // own language as the call's first message.
  introMessage: GREETINGS.te,
  languages: ['Telugu', 'Hindi', 'English'],
  initialLanguage: 'Telugu',
  voice: { name: 'Kavitha – Conversational', internalId: KAVITHA_VOICE_ID },
  maxCallSeconds: MAX_CALL_SECONDS,
  agentVariables: [
    {
      name: CALL_TOKEN_VARIABLE,
      description: 'One-time call token for our tools. Internal: never say it aloud.',
      sendToLlm: false,
    },
    {
      name: 'shopkeeper_name',
      description: 'Shopkeeper being called, e.g. Ramesh',
      sendToLlm: true,
    },
    { name: 'shop_name', description: 'Their shop, e.g. Ramesh Kirana', sendToLlm: true },
    {
      name: 'owner_name',
      description: 'Owner Asha calls for, e.g. Srinivas Reddy',
      sendToLlm: true,
    },
    {
      name: 'business_name',
      description: "Owner's business, e.g. Sri Lakshmi Traders",
      sendToLlm: true,
    },
    { name: 'today', description: 'Today in India, e.g. Monday, 2026-11-02', sendToLlm: true },
  ],
  tools: ASHA_TOOLS,
  toolSecretName: TOOL_SECRET_NAME,
};
