// supabase/functions/vapi-webhook/index.ts
// Deployed with --no-verify-jwt: Vapi cannot send a Supabase JWT. The shared-secret header is
// checked in the handler before anything else.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadWebhookEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { handleWebhook, type WebhookDeps } from './handler.ts';

const env = loadWebhookEnv(Deno.env.toObject());
const deps: WebhookDeps = {
  repo: createSupabaseRepository(createPostgrestClient(env)),
  secret: env.VAPI_WEBHOOK_SECRET,
  clock: () => new Date(),
  log: logToConsole,
};

Deno.serve((req) => handleWebhook(req, deps));
