// supabase/functions/calls-api/index.ts
// JWT verification stays on: the dashboard sends the public anon key, which Supabase checks.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadCallsApiEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { type CallsApiDeps, handleCallsApi } from './handler.ts';

const env = loadCallsApiEnv(Deno.env.toObject());
const deps: CallsApiDeps = {
  repo: createSupabaseRepository(createPostgrestClient(env)),
  clock: () => new Date(),
  log: logToConsole,
  allowedOrigins: env.CORS_ALLOWED_ORIGINS,
};

Deno.serve((req) => handleCallsApi(req, deps));
