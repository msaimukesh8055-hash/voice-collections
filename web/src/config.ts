// web/src/config.ts
// Browser config, validated at startup. Only public values are allowed here (security.md).
import { z } from 'zod';
import assistantRecord from '@voice-agents/collections/vapi-assistant.json';

const BrowserEnvSchema = z.object({
  VITE_VAPI_PUBLIC_KEY: z.string().trim().min(1),
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1),
  VITE_SUPABASE_REGION: z.string().trim().min(1),
});

const AssistantRecordSchema = z.object({ assistantId: z.string().trim().min(1) });

export interface BrowserConfig {
  readonly vapiPublicKey: string;
  readonly assistantId: string;
  /** calls-api base URL (Supabase Edge Function). */
  readonly callsApiUrl: string;
  /** Public anon key: lets Supabase accept the request; RLS still blocks all table access. */
  readonly supabaseAnonKey: string;
  /** Region the functions run in (next to the database, ADR-0008). */
  readonly supabaseRegion: string;
}

export function loadBrowserConfig(env: Record<string, unknown>, record: unknown): BrowserConfig {
  const parsedEnv = BrowserEnvSchema.safeParse(env);
  if (!parsedEnv.success) {
    const names = parsedEnv.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid in .env: ${names}`);
  }
  const parsedRecord = AssistantRecordSchema.safeParse(record);
  if (!parsedRecord.success) throw new Error('Assistant not pushed yet — run npm run agent:push');
  return {
    vapiPublicKey: parsedEnv.data.VITE_VAPI_PUBLIC_KEY,
    assistantId: parsedRecord.data.assistantId,
    callsApiUrl: `${parsedEnv.data.VITE_SUPABASE_URL}/functions/v1/calls-api`,
    supabaseAnonKey: parsedEnv.data.VITE_SUPABASE_ANON_KEY,
    supabaseRegion: parsedEnv.data.VITE_SUPABASE_REGION,
  };
}

export function loadAppConfig(): BrowserConfig {
  return loadBrowserConfig(import.meta.env, assistantRecord);
}
