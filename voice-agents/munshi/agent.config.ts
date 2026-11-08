// voice-agents/munshi/agent.config.ts
// Munshi — the owner's call line (M8, ADR-0018): a second Sarvam voice agent, for the owner only.
// Source of truth for what is pushed to Sarvam (npm run agent:build -- --agent munshi renders it).
import { OWNER_CALL_TOKEN_VARIABLE } from '../../supabase/functions/_shared/sarvam.ts';
import { type AgentConfig, MAX_OWNER_CALL_SECONDS } from '../schema.ts';
import { MUNSHI_GREETING } from './greetings.ts';
import { MUNSHI_PROMPT } from './prompt.ts';
import { MUNSHI_TOOLS } from './tools.ts';

/** Munshi's Bulbul voice (M8 Decision 1). Change this one constant to switch voice. Others
 * auditioned in the console: Kabir 01a0cf17-13fb-71b7-83c5-f8e21aca30fa, Mohit
 * 01a0cf16-92ef-7beb-a599-7def88873140, Tarun Narrator (Telugu)
 * 01a0cf16-9e86-7043-9562-96c80fd0e6ac. */
export const MUNSHI_VOICE = {
  name: 'Aayan - Conversational Voice',
  internalId: '01a0cf17-18ac-7ceb-aac2-5f0c39f86831',
} as const;

/** Name of the bearer secret in Sarvam's Secrets vault; its value is SARVAM_OWNER_TOOL_SECRET
 * (never Asha's easy-recovery-tool-secret). */
export const OWNER_TOOL_SECRET_NAME = 'easy-recovery-owner-tool-secret';

export const munshiAgent: AgentConfig = {
  name: 'Munshi-Easy-Recovery', // Sarvam allows only letters, numbers, spaces, _ and -
  description:
    "The owner's call line for Sri Lakshmi Traders (fake prototype): casual answers about the " +
    'credit book from tools only, read-backs before any change.',
  prompt: MUNSHI_PROMPT,
  introMessage: MUNSHI_GREETING,
  languages: ['Telugu', 'Hindi', 'English'],
  initialLanguage: 'Telugu',
  voice: MUNSHI_VOICE,
  maxCallSeconds: MAX_OWNER_CALL_SECONDS,
  agentVariables: [
    {
      name: OWNER_CALL_TOKEN_VARIABLE,
      description: 'One-time owner call token for our tools. Internal: never say it aloud.',
      sendToLlm: false,
    },
    { name: 'owner_short_name', description: 'Owner first name, e.g. Srinivas', sendToLlm: true },
    { name: 'owner_name', description: 'Owner full name, e.g. Srinivas Reddy', sendToLlm: true },
    {
      name: 'business_name',
      description: "Owner's business, e.g. Sri Lakshmi Traders",
      sendToLlm: true,
    },
    { name: 'today', description: 'Today in India, e.g. Saturday, 2026-11-07', sendToLlm: true },
  ],
  tools: MUNSHI_TOOLS,
  toolSecretName: OWNER_TOOL_SECRET_NAME,
};
