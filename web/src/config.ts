// web/src/config.ts
// Browser config, validated at startup. Only public values are allowed here (security.md): the
// Sarvam key stays on the server, behind the calls-api proxy (ADR-0012).
import { z } from 'zod';

const BrowserEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1),
  VITE_SUPABASE_REGION: z.string().trim().min(1),
});

export interface BrowserConfig {
  /** calls-api base URL (Supabase Edge Function). */
  readonly appApiUrl: string;
  /** Public anon key: lets Supabase accept the request; RLS still blocks all table access. */
  readonly anonKey: string;
  /** Region the functions run in, next to the database (ADR-0008). */
  readonly region: string;
}

export function loadBrowserConfig(env: Record<string, unknown>): BrowserConfig {
  const parsed = BrowserEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid in .env: ${names}`);
  }
  const supabaseUrl = parsed.data.VITE_SUPABASE_URL.replace(/\/$/, '');
  return {
    appApiUrl: `${supabaseUrl}/functions/v1/calls-api`,
    anonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
    region: parsed.data.VITE_SUPABASE_REGION,
  };
}

export function loadAppConfig(): BrowserConfig {
  return loadBrowserConfig(import.meta.env);
}
