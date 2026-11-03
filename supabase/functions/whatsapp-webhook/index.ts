// supabase/functions/whatsapp-webhook/index.ts
// Deployed with --no-verify-jwt: Meta cannot send a Supabase JWT. Every POST is checked against
// Meta's X-Hub-Signature-256 (App Secret) in the handler before anything is read.
import { createBrainLlm } from '../_shared/brain/llm.ts';
import { randomFakePhone } from '../_shared/cards/context.ts';
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseBookRepository } from '../_shared/db/supabase-book-repository.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadWhatsAppEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { createWhatsAppClient } from '../_shared/whatsapp/client.ts';
import { handleWebhook, type WebhookDeps } from './handler.ts';
import { type ProcessDeps, processPayload } from './process.ts';

/** Supabase Edge Runtime global: keeps the worker alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadWhatsAppEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
const processDeps: ProcessDeps = {
  book: createSupabaseBookRepository(query),
  client: createWhatsAppClient({
    accessToken: env.META_ACCESS_TOKEN,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
    fetchImpl: fetch,
    log: logToConsole,
  }),
  llm: createBrainLlm({
    sarvamApiKey: env.SARVAM_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    fetchImpl: fetch,
    log: logToConsole,
  }),
  sender: { ownerNumber: env.OWNER_WHATSAPP_NUMBER, hashKey: env.META_APP_SECRET },
  phoneNumberId: env.META_PHONE_NUMBER_ID,
  clock: () => new Date(),
  getDemoSettings: createSupabaseRepository(query).getDemoSettings,
  newPhone: () => randomFakePhone(),
  log: logToConsole,
};

const deps: WebhookDeps = {
  verifyToken: env.WHATSAPP_VERIFY_TOKEN,
  appSecret: env.META_APP_SECRET,
  defer: (task) => EdgeRuntime.waitUntil(task),
  process: (payload) => processPayload(payload, processDeps),
  log: logToConsole,
};

Deno.serve((req) => handleWebhook(req, deps));
