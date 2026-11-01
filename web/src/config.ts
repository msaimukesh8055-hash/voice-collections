// web/src/config.ts
// Browser config, validated at startup. Only public values are allowed here (security.md).
import { z } from 'zod';
import assistantRecord from '@agent/collections/vapi-assistant.json';

const BrowserEnvSchema = z.object({
  VITE_VAPI_PUBLIC_KEY: z.string().trim().min(1),
});

const AssistantRecordSchema = z.object({ assistantId: z.string().trim().min(1) });

export interface BrowserConfig {
  readonly vapiPublicKey: string;
  readonly assistantId: string;
}

export function loadBrowserConfig(env: Record<string, unknown>, record: unknown): BrowserConfig {
  const parsedEnv = BrowserEnvSchema.safeParse(env);
  if (!parsedEnv.success) throw new Error('Missing VITE_VAPI_PUBLIC_KEY in .env');
  const parsedRecord = AssistantRecordSchema.safeParse(record);
  if (!parsedRecord.success) throw new Error('Assistant not pushed yet — run npm run agent:push');
  return {
    vapiPublicKey: parsedEnv.data.VITE_VAPI_PUBLIC_KEY,
    assistantId: parsedRecord.data.assistantId,
  };
}

export function loadAppConfig(): BrowserConfig {
  return loadBrowserConfig(import.meta.env, assistantRecord);
}
