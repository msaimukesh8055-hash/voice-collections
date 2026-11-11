// supabase/functions/munshi-tools/index.ts
// Deployed with --no-verify-jwt: Sarvam cannot send a Supabase JWT. The owner tool secret is
// checked in the handler before anything else. Imports stay lean (no Asha tools, no LLM client,
// no Meta client) so a cold start stays short; the call page also pings /munshi-tools/warm.
// Build B: confirm_action writes through the same repositories and queueCall as WhatsApp, and a
// WhatsApp send is only a background kick to the follow-up worker (WORKER_SECRET).
import { queueCall } from '../_shared/calls/queue-call.ts';
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseBookRepository } from '../_shared/db/supabase-book-repository.ts';
import { createSupabaseFollowupRepository } from '../_shared/db/supabase-followup-repository.ts';
import { createSupabaseOwnerCallRepository } from '../_shared/db/supabase-owner-call-repository.ts';
import { createSupabaseReminderRepository } from '../_shared/db/supabase-reminder-repository.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { createSupabaseVoiceActionRepository } from '../_shared/db/supabase-voice-action-repository.ts';
import { loadOwnerToolsEnv } from '../_shared/env.ts';
import { createJobKicker, followupWorkerUrl, ownerSendPath } from '../_shared/followup/kick.ts';
import { logToConsole } from '../_shared/log.ts';
import { createOpsEventWriter } from '../_shared/ops/store.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { handleOwnerToolRequest, type OwnerToolsDeps } from './handler.ts';

/** Supabase Edge Runtime global: keeps the function alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadOwnerToolsEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
// M9: every request gets a trace; log lines and background work join it (ops_events).
const tracing = createTracing({
  source: 'munshi-tools',
  write: createOpsEventWriter(query),
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  baseLog: logToConsole,
});
const log = tracing.log;
const repo = createSupabaseRepository(query);
const book = createSupabaseBookRepository(query);
const followups = createSupabaseFollowupRepository(query);
const clock = (): Date => new Date();
const kickJob = createJobKicker({
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log,
  defer: tracing.defer,
});

const deps: OwnerToolsDeps = {
  ownerCalls: createSupabaseOwnerCallRepository(query),
  reads: {
    book,
    memory: repo,
    alerts: createSupabaseReminderRepository(query),
    listCallStatuses: (shopkeeperId) => followups.listCallStatuses(shopkeeperId),
  },
  writes: {
    actions: createSupabaseVoiceActionRepository(query),
    book,
    queueCall: (shopkeeperId) => queueCall({ repo, clock }, { shopkeeperId, mode: 'live' }),
    kickOwnerSend: (actionId) => kickJob(ownerSendPath(actionId)),
  },
  getDemoSettings: () => repo.getDemoSettings(),
  getOwner: () => book.getOwner(),
  secret: env.SARVAM_OWNER_TOOL_SECRET,
  clock,
  log,
};

Deno.serve(tracing.serve((req) => handleOwnerToolRequest(req, deps)));
