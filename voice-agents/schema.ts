// voice-agents/schema.ts
// Shape of a Sarvam voice agent kept as code (SPEC §7.6, ADR-0012). Validated before the build
// script renders the JSON the coordinator pushes with the Sarvam MCP connector.
import { z } from 'zod';

/** Credit guard: no call runs past 4 minutes, demo day included (Saim, M2). */
export const MAX_CALL_SECONDS = 240;

export const SARVAM_LANGUAGES = ['Telugu', 'Hindi', 'English'] as const;
export const SarvamLanguageSchema = z.enum(SARVAM_LANGUAGES);

const NonEmptyText = z.string().trim().min(1);
const VariableName = z.string().regex(/^[a-z_]+$/);

export const AgentVariableSchema = z.object({
  name: VariableName,
  description: NonEmptyText,
  /** Sarvam's "send to LLM" switch. Off for anything the model must never say (the token). */
  sendToLlm: z.boolean(),
});

/** One field of a tool's JSON body: either an agent variable or something the LLM decides. */
export const BodyFieldSchema = z.discriminatedUnion('source', [
  z.object({ key: VariableName, source: z.literal('agent_variable'), variable: VariableName }),
  z.object({
    key: VariableName,
    source: z.literal('llm_prompt'),
    type: z.enum(['string', 'number']),
    description: NonEmptyText,
    required: z.boolean(),
    enum: z.array(NonEmptyText).optional(),
  }),
]);

export const ApiToolSchema = z.object({
  name: VariableName,
  description: NonEmptyText,
  method: z.literal('POST'),
  /** Path under the Supabase functions URL, e.g. /sarvam-tools/get_dues. */
  path: z.string().regex(/^\/sarvam-tools\/[a-z_]+$/),
  body: z.array(BodyFieldSchema).min(1),
  /** Jinja template over our JSON reply; every reply carries a ready-made `say`. */
  respTemplate: NonEmptyText,
  onFailure: NonEmptyText,
  timeoutSeconds: z.number().int().positive().max(30),
});

export const AgentConfigSchema = z.object({
  name: NonEmptyText,
  description: NonEmptyText,
  prompt: NonEmptyText,
  introMessage: NonEmptyText,
  languages: z.array(SarvamLanguageSchema).min(1),
  initialLanguage: SarvamLanguageSchema,
  voice: z.object({ name: NonEmptyText, internalId: z.uuid() }),
  maxCallSeconds: z.number().int().positive().max(MAX_CALL_SECONDS),
  agentVariables: z.array(AgentVariableSchema).min(1),
  tools: z.array(ApiToolSchema).min(1),
  /** Name of the bearer-token secret in Sarvam's Secrets vault (attached in the console). */
  toolSecretName: NonEmptyText,
});

export type AgentVariable = z.infer<typeof AgentVariableSchema>;
export type BodyField = z.infer<typeof BodyFieldSchema>;
export type ApiTool = z.infer<typeof ApiToolSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SarvamLanguage = z.infer<typeof SarvamLanguageSchema>;
