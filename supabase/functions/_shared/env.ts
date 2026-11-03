// supabase/functions/_shared/env.ts
import { z } from 'zod';

const MIN_TOOL_SECRET_LENGTH = 32;
/** Country code + subscriber number; anything shorter is a typo in the secret. */
const MIN_PHONE_DIGITS = 10;

const NonEmpty = z.string().trim().min(1);

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
});

const ToolsEnvSchema = ServerEnvSchema.extend({
  /** Bearer secret Sarvam sends on every tool call (stored in Sarvam's Secrets vault). */
  SARVAM_TOOL_SECRET: z.string().trim().min(MIN_TOOL_SECRET_LENGTH),
});

const CallsApiEnvSchema = ServerEnvSchema.extend({
  /** Comma-separated dashboard origins allowed to call the API from a browser. */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  /** Voice Agents key (indus.sarvam.ai): only the call-URL proxy uses it, never the browser. */
  SARVAM_AGENTS_API_KEY: NonEmpty,
  SARVAM_ORG_ID: NonEmpty,
  SARVAM_WORKSPACE_ID: NonEmpty,
  /** Asha's Sarvam app id; blank until the agent exists, and then calls are refused. */
  SARVAM_APP_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null)),
});

/** WhatsApp Business numbers arrive from Meta as digits only, with the country code. */
const PhoneDigits = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().min(MIN_PHONE_DIGITS));

const WhatsAppEnvSchema = ServerEnvSchema.extend({
  /** System-user token (M4 Decision 2); sends replies through the Cloud API. */
  META_ACCESS_TOKEN: NonEmpty,
  META_PHONE_NUMBER_ID: z.string().trim().regex(/^\d+$/),
  /** Checks Meta's X-Hub-Signature-256 on every webhook POST, and keys the sender hash. */
  META_APP_SECRET: NonEmpty,
  /** Answered to Meta's one-off GET verify check. */
  WHATSAPP_VERIFY_TOKEN: NonEmpty,
  /** The only number the bot answers (Decision 6). Never logged, never stored. */
  OWNER_WHATSAPP_NUMBER: PhoneDigits,
  /** Sarvam core API key (chat completions), not the Voice Agents key. */
  SARVAM_API_KEY: NonEmpty,
  GEMINI_API_KEY: NonEmpty,
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type WhatsAppEnv = z.infer<typeof WhatsAppEnvSchema>;
export type ToolsEnv = z.infer<typeof ToolsEnvSchema>;
export type CallsApiEnv = z.infer<typeof CallsApiEnvSchema>;

export class MissingEnvError extends Error {
  override name = 'MissingEnvError';
}

/** Validates env at startup. Reports variable names only — never values. */
function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new MissingEnvError(`Missing or invalid environment variables: ${names}`);
}

export function loadServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return loadEnv(ServerEnvSchema, source);
}

export function loadToolsEnv(source: Record<string, string | undefined>): ToolsEnv {
  return loadEnv(ToolsEnvSchema, source);
}

export function loadCallsApiEnv(source: Record<string, string | undefined>): CallsApiEnv {
  return loadEnv(CallsApiEnvSchema, source);
}

export function loadWhatsAppEnv(source: Record<string, string | undefined>): WhatsAppEnv {
  return loadEnv(WhatsAppEnvSchema, source);
}
