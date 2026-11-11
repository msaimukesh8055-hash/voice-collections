// supabase/functions/calls-api/index.ts
// JWT verification stays on: the dashboard and phone page send the public anon key (the phone
// page adds it to the Sarvam SDK's request too), which Supabase checks.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { createSupabaseBookRepository } from '../_shared/db/supabase-book-repository.ts';
import { createSupabaseDashboardRepository } from '../_shared/db/supabase-dashboard-repository.ts';
import { createSupabaseOpsRepository } from '../_shared/db/supabase-ops-repository.ts';
import { createSupabaseFollowupRepository } from '../_shared/db/supabase-followup-repository.ts';
import { createSupabaseOwnerCallRepository } from '../_shared/db/supabase-owner-call-repository.ts';
import { loadCallsApiEnv } from '../_shared/env.ts';
import { createFollowupKicker, followupWorkerUrl } from '../_shared/followup/kick.ts';
import { logToConsole } from '../_shared/log.ts';
import { createOpsEventWriter } from '../_shared/ops/store.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { handleCallsApi } from './handler.ts';
import { createTranslator } from '../_shared/speech/translate.ts';
import type { CallsApiDeps } from './types.ts';

/** Supabase Edge Runtime global: keeps the function alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadCallsApiEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
// M9: every request gets a trace; log lines and background work join it (ops_events).
const tracing = createTracing({
  source: 'calls-api',
  write: createOpsEventWriter(query),
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  baseLog: logToConsole,
});
const log = tracing.log;
const kick = createFollowupKicker({
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log,
  defer: tracing.defer,
});

const repo = createSupabaseRepository(query);
const book = createSupabaseBookRepository(query);
const deps: CallsApiDeps = {
  repo,
  clock: () => new Date(),
  log,
  allowedOrigins: env.CORS_ALLOWED_ORIGINS,
  sarvam: {
    apiKey: env.SARVAM_AGENTS_API_KEY,
    orgId: env.SARVAM_ORG_ID,
    workspaceId: env.SARVAM_WORKSPACE_ID,
    appId: env.SARVAM_APP_ID,
    munshiAppId: env.SARVAM_MUNSHI_APP_ID,
  },
  fetchImpl: fetch,
  kickFollowup: kick,
  dashboard: {
    linkSecret: env.DASHBOARD_LINK_SECRET,
    publicDemo: env.DASHBOARD_PUBLIC,
    book,
    reads: createSupabaseDashboardRepository(query),
    ops: createSupabaseOpsRepository(query),
    translate: env.SARVAM_API_KEY
      ? createTranslator({ apiKey: env.SARVAM_API_KEY, fetchImpl: fetch, log })
      : null,
    score: {
      listPromises: repo.listPromises,
      listCallStatuses: createSupabaseFollowupRepository(query).listCallStatuses,
    },
  },
  munshi: {
    ownerCalls: createSupabaseOwnerCallRepository(query),
    linkSecret: env.MUNSHI_LINK_SECRET,
    getOwner: book.getOwner,
  },
};

Deno.serve(tracing.serve((req) => handleCallsApi(req, deps)));
