// supabase/functions/calls-api/index.ts
// JWT verification stays on: the dashboard and phone page send the public anon key (the phone
// page adds it to the Sarvam SDK's request too), which Supabase checks.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { createSupabaseBookRepository } from '../_shared/db/supabase-book-repository.ts';
import { createSupabaseDashboardRepository } from '../_shared/db/supabase-dashboard-repository.ts';
import { createSupabaseFollowupRepository } from '../_shared/db/supabase-followup-repository.ts';
import { loadCallsApiEnv } from '../_shared/env.ts';
import { createFollowupKicker, followupWorkerUrl } from '../_shared/followup/kick.ts';
import { logToConsole } from '../_shared/log.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

/** Supabase Edge Runtime global: keeps the function alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadCallsApiEnv(Deno.env.toObject());
const kick = createFollowupKicker({
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log: logToConsole,
  defer: (task: Promise<unknown>): void => EdgeRuntime.waitUntil(task),
});

const query = createPostgrestClient(env);
const repo = createSupabaseRepository(query);
const deps: CallsApiDeps = {
  repo,
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
  kickFollowup: kick,
  dashboard: {
    linkSecret: env.DASHBOARD_LINK_SECRET,
    book: createSupabaseBookRepository(query),
    reads: createSupabaseDashboardRepository(query),
    score: {
      listPromises: repo.listPromises,
      listCallStatuses: createSupabaseFollowupRepository(query).listCallStatuses,
    },
  },
};

Deno.serve((req) => handleCallsApi(req, deps));
