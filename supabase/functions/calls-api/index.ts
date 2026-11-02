// supabase/functions/calls-api/index.ts
// JWT verification stays on: the dashboard and phone page send the public anon key (the phone
// page adds it to the Sarvam SDK's request too), which Supabase checks.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadCallsApiEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

const env = loadCallsApiEnv(Deno.env.toObject());
const deps: CallsApiDeps = {
  repo: createSupabaseRepository(createPostgrestClient(env)),
  clock: () => new Date(),
  log: logToConsole,
  allowedOrigins: env.CORS_ALLOWED_ORIGINS,
  sarvam: {
    apiKey: env.SARVAM_AGENTS_API_KEY,
    orgId: env.SARVAM_ORG_ID,
    workspaceId: env.SARVAM_WORKSPACE_ID,
    appId: env.SARVAM_APP_ID,
  },
  fetchImpl: fetch,
};

Deno.serve((req) => handleCallsApi(req, deps));
