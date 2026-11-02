// supabase/functions/_shared/env.ts
import { z } from 'zod';

const MIN_WEBHOOK_SECRET_LENGTH = 32;

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
});

const WebhookEnvSchema = ServerEnvSchema.extend({
  VAPI_WEBHOOK_SECRET: z.string().trim().min(MIN_WEBHOOK_SECRET_LENGTH),
});

const CallsApiEnvSchema = ServerEnvSchema.extend({
  /** Comma-separated dashboard origins allowed to call the API from a browser. */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type WebhookEnv = z.infer<typeof WebhookEnvSchema>;
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

export function loadWebhookEnv(source: Record<string, string | undefined>): WebhookEnv {
  return loadEnv(WebhookEnvSchema, source);
}

export function loadCallsApiEnv(source: Record<string, string | undefined>): CallsApiEnv {
  return loadEnv(CallsApiEnvSchema, source);
}
