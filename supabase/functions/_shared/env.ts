// supabase/functions/_shared/env.ts
import { z } from 'zod';

const MIN_TOOL_SECRET_LENGTH = 32;
const MIN_WORKER_SECRET_LENGTH = 32;
/** Dashboard link secret: random, 32+ characters (M6). */
const MIN_DASHBOARD_SECRET_LENGTH = 32;
/** Munshi's link secret (M8): random, 32+ characters, not the dashboard secret. */
const MIN_MUNSHI_SECRET_LENGTH = 32;
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

/** Optional: blank means "not set up", and the bot says so instead of sending a link. */
const OptionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null));

/** Optional Munshi link secret: blank means "Munshi is not set up yet" (M8). */
const OptionalMunshiSecret = OptionalText.pipe(z.string().min(MIN_MUNSHI_SECRET_LENGTH).nullable());

/** munshi-tools (M8, ADR-0018): its own bearer secret, never Asha's. Supabase gives every function
 * every secret, so Asha's is usually present too and is checked to differ. */
const OwnerToolsEnvSchema = ServerEnvSchema.extend({
  /** Bearer secret Sarvam sends on Munshi's tool calls (vault: easy-recovery-owner-tool-secret). */
  SARVAM_OWNER_TOOL_SECRET: z.string().trim().min(MIN_TOOL_SECRET_LENGTH),
  SARVAM_TOOL_SECRET: OptionalText,
  /** Bearer secret for followup-worker: confirm_action kicks /owner-send with it (M8 B5). */
  WORKER_SECRET: z.string().trim().min(MIN_WORKER_SECRET_LENGTH),
}).refine((env) => env.SARVAM_OWNER_TOOL_SECRET !== env.SARVAM_TOOL_SECRET, {
  path: ['SARVAM_OWNER_TOOL_SECRET'],
  message: 'must differ from SARVAM_TOOL_SECRET',
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
  /** Bearer secret for followup-worker: calls-api sends it when a call ends (M5). */
  WORKER_SECRET: z.string().trim().min(MIN_WORKER_SECRET_LENGTH),
  /** Signs and checks the dashboard's 24-hour links (M6 Decision 9). */
  DASHBOARD_LINK_SECRET: z.string().trim().min(MIN_DASHBOARD_SECRET_LENGTH),
  /** Public demo: "on" lets anyone use the dashboard (overview, customers, calls, transcripts, the switch)
   * without the WhatsApp link. Fake data only. Blank or anything else → the link is required. */
  DASHBOARD_PUBLIC: z
    .string()
    .trim()
    .optional()
    .transform((value) => value === 'on'),
  /** Sarvam core key: the dashboard's transcript English (M6). Blank → no translation. */
  SARVAM_API_KEY: OptionalText,
  /** Munshi (M8): checks the /munshi page's link token. Blank → Munshi is not set up. */
  MUNSHI_LINK_SECRET: OptionalMunshiSecret,
  /** Munshi's Sarvam app id; blank until the agent exists, and then Munshi calls are refused. */
  SARVAM_MUNSHI_APP_ID: OptionalText,
});

/** WhatsApp Business numbers arrive from Meta as digits only, with the country code. */
const PhoneDigits = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().min(MIN_PHONE_DIGITS));

/** Meta's phone number id: digits only. */
const MetaPhoneNumberId = z.string().trim().regex(/^\d+$/);

const WhatsAppEnvSchema = ServerEnvSchema.extend({
  /** System-user token (M4 Decision 2); sends replies through the Cloud API. */
  META_ACCESS_TOKEN: NonEmpty,
  META_PHONE_NUMBER_ID: MetaPhoneNumberId,
  /** Checks Meta's X-Hub-Signature-256 on every webhook POST, and keys the sender hash. */
  META_APP_SECRET: NonEmpty,
  /** Answered to Meta's one-off GET verify check. */
  WHATSAPP_VERIFY_TOKEN: NonEmpty,
  /** The only number the bot answers (Decision 6). Never logged, never stored. */
  OWNER_WHATSAPP_NUMBER: PhoneDigits,
  /** Sarvam core API key (chat completions), not the Voice Agents key. */
  SARVAM_API_KEY: NonEmpty,
  GEMINI_API_KEY: NonEmpty,
  /** Bearer secret for followup-worker: Remind starts simulated calls there (M5 5b). */
  WORKER_SECRET: z.string().trim().min(MIN_WORKER_SECRET_LENGTH),
  /** The dashboard link (M6): where the web app runs, and the secret that signs the link. Both
   * optional: without them "insights" and "dashboard" just leave the link out. */
  DASHBOARD_URL: OptionalText.pipe(z.url().nullable()),
  DASHBOARD_LINK_SECRET: OptionalText.pipe(
    z.string().min(MIN_DASHBOARD_SECRET_LENGTH).nullable(),
  ),
  /** Munshi (M8): signs the "Call Munshi" link. Blank → the bot says Munshi is not set up. */
  MUNSHI_LINK_SECRET: OptionalMunshiSecret,
});

/** followup-worker (M5): Sarvam transcripts + LLM, the owner's WhatsApp summary, its own secret. */
const WorkerEnvSchema = CallsApiEnvSchema.omit({
  CORS_ALLOWED_ORIGINS: true,
  DASHBOARD_LINK_SECRET: true,
  MUNSHI_LINK_SECRET: true,
  SARVAM_MUNSHI_APP_ID: true,
}).extend({
  META_ACCESS_TOKEN: NonEmpty,
  META_PHONE_NUMBER_ID: MetaPhoneNumberId,
  /** Keys the stored hash of the owner's number (same as the webhook). */
  META_APP_SECRET: NonEmpty,
  OWNER_WHATSAPP_NUMBER: PhoneDigits,
  /** M9: who gets failure alerts. In a real deployment the engineer on call, not the trader;
   * blank means the owner's number (the demo, where both are Saim's phone). */
  OPS_ALERT_WHATSAPP_NUMBER: OptionalText.pipe(PhoneDigits.nullable()),
  SARVAM_API_KEY: NonEmpty,
  GEMINI_API_KEY: NonEmpty,
  /** Dry-run fix 8: the call summary's transcript link (same signed link as "dashboard"). Both
   * optional: without them the summary leaves the link out. */
  DASHBOARD_URL: OptionalText.pipe(z.url().nullable()),
  DASHBOARD_LINK_SECRET: OptionalText.pipe(
    z.string().min(MIN_DASHBOARD_SECRET_LENGTH).nullable(),
  ),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;
export type WhatsAppEnv = z.infer<typeof WhatsAppEnvSchema>;
export type ToolsEnv = z.infer<typeof ToolsEnvSchema>;
export type OwnerToolsEnv = z.infer<typeof OwnerToolsEnvSchema>;
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

export function loadOwnerToolsEnv(source: Record<string, string | undefined>): OwnerToolsEnv {
  return loadEnv(OwnerToolsEnvSchema, source);
}

export function loadCallsApiEnv(source: Record<string, string | undefined>): CallsApiEnv {
  return loadEnv(CallsApiEnvSchema, source);
}

export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return loadEnv(WorkerEnvSchema, source);
}

export function loadWhatsAppEnv(source: Record<string, string | undefined>): WhatsAppEnv {
  return loadEnv(WhatsAppEnvSchema, source);
}
