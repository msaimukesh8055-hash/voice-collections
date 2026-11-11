// supabase/functions/followup-worker/index.ts
// Deployed with --no-verify-jwt: calls-api and pg_cron call it with WORKER_SECRET (checked in
// the handler before anything else), not a Supabase JWT.
import {
  callLink,
  dashboardLink,
  shopkeeperLink,
  traceLink,
} from '../_shared/auth/dashboard-link.ts';
import { createSupabaseOpsRepository } from '../_shared/db/supabase-ops-repository.ts';
import { runOpsWatch, withoutErrors } from '../_shared/ops/watch.ts';
import { createSupabaseVoiceActionRepository } from '../_shared/db/supabase-voice-action-repository.ts';
import { sendOwnerRequest } from '../_shared/reminders/owner-send.ts';
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseBookRepository } from '../_shared/db/supabase-book-repository.ts';
import { createSupabaseFollowupRepository } from '../_shared/db/supabase-followup-repository.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadWorkerEnv } from '../_shared/env.ts';
import {
  createFollowupKicker,
  createJobKicker,
  followupWorkerUrl,
  SIMULATION_NEXT_PATH,
} from '../_shared/followup/kick.ts';
import {
  type FollowupDeps,
  processFollowup,
  RETRY_DELAY_MS,
  sweepFollowups,
} from '../_shared/followup/process.ts';
import { createSupabaseReminderRepository } from '../_shared/db/supabase-reminder-repository.ts';
import {
  askGeminiChat,
  askSarvamChat,
  createJsonLlm,
  type JsonLlmConfig,
} from '../_shared/llm/json-llm.ts';
import { sendDailyAlert } from '../_shared/reminders/daily-alert.ts';
import { runPromiseCheck } from '../_shared/reminders/promise-check-job.ts';
import { runNextSimulation, type SimulatorDeps } from '../_shared/simulator/run.ts';
import { logToConsole } from '../_shared/log.ts';
import { createOpsEventWriter } from '../_shared/ops/store.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { createTranscriptClient } from '../_shared/sarvam-analytics.ts';
import { createWhatsAppClient } from '../_shared/whatsapp/client.ts';
import { ownerTwinSettings, withEnglishTwin } from '../_shared/whatsapp/english-twin.ts';
import { createTranslator } from '../_shared/speech/translate.ts';
import { handleWorkerRequest, type WorkerDeps } from './handler.ts';

/** Supabase Edge Runtime global: keeps the worker alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadWorkerEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
// M9: every request gets a trace; log lines and background work join it (ops_events).
const tracing = createTracing({
  source: 'followup-worker',
  write: createOpsEventWriter(query),
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  baseLog: logToConsole,
  // Its callers are our own functions and pg_cron (WORKER_SECRET), so a kick keeps its trace.
  acceptTraceHeader: true,
});
const log = tracing.log;
const defer = tracing.defer;
const kickerConfig = {
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log,
  defer,
};
const kick = createFollowupKicker(kickerConfig);
const kickJob = createJobKicker(kickerConfig);
const llmConfig: JsonLlmConfig = {
  sarvamApiKey: env.SARVAM_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  fetchImpl: fetch,
  log,
};

const book = createSupabaseBookRepository(query);
const followupDeps: FollowupDeps = {
  repo: createSupabaseRepository(query),
  followups: createSupabaseFollowupRepository(query),
  book,
  llm: createJsonLlm(llmConfig),
  transcripts: createTranscriptClient({
    apiKey: env.SARVAM_AGENTS_API_KEY,
    orgId: env.SARVAM_ORG_ID,
    workspaceId: env.SARVAM_WORKSPACE_ID,
    appId: env.SARVAM_APP_ID,
    fetchImpl: fetch,
    log,
  }),
  // M6: Telugu summaries and alerts get their English underneath when the demo setting is on.
  whatsapp: withEnglishTwin(
    createWhatsAppClient({
      accessToken: env.META_ACCESS_TOKEN,
      phoneNumberId: env.META_PHONE_NUMBER_ID,
      fetchImpl: fetch,
      log,
    }),
    {
      translate: createTranslator({
        apiKey: env.SARVAM_API_KEY,
        fetchImpl: fetch,
        log,
      }),
      loadSettings: ownerTwinSettings(book),
      clock: () => new Date(),
    },
  ),
  owner: { ownerNumber: env.OWNER_WHATSAPP_NUMBER, hashKey: env.META_APP_SECRET },
  clock: () => new Date(),
  log,
  requeue: (callId) => kick(callId, RETRY_DELAY_MS),
  // Dry-run fix 8: "🔗 Transcript" in the summary opens that call on the dashboard (24 h link).
  callLink: (callId) =>
    env.DASHBOARD_URL && env.DASHBOARD_LINK_SECRET
      ? callLink(env.DASHBOARD_URL, env.DASHBOARD_LINK_SECRET, { callId, now: new Date() })
      : Promise.resolve(null),
};

const store = createSupabaseReminderRepository(query);
const sarvamChat = {
  name: 'sarvam',
  ask: (r) => askSarvamChat(llmConfig, r),
} as const satisfies SimulatorDeps['asha'];
const geminiChat = {
  name: 'gemini',
  ask: (r) => askGeminiChat(llmConfig, r),
} as const satisfies SimulatorDeps['asha'];
const simulatorDeps: SimulatorDeps = {
  repo: followupDeps.repo,
  store,
  // Asha is the product: always Sarvam. The shopkeeper is Gemini, Sarvam if Gemini fails.
  asha: sarvamChat,
  shopkeeper: [geminiChat, sarvamChat],
  clock: followupDeps.clock,
  log,
  kickFollowup: (callId) => kick(callId),
  startNext: () => kickJob(SIMULATION_NEXT_PATH),
};
const jobDeps = { ...followupDeps, store };
// M8 B5: what the owner asked Munshi to send; links only when a dashboard is set up.
const linkBase = env.DASHBOARD_URL && env.DASHBOARD_LINK_SECRET
  ? { url: env.DASHBOARD_URL, secret: env.DASHBOARD_LINK_SECRET }
  : null;
const ownerSendDeps = {
  ...jobDeps,
  actions: createSupabaseVoiceActionRepository(query),
  listCallStatuses: (shopkeeperId: string) => followupDeps.followups.listCallStatuses(shopkeeperId),
  dashboardLink: () =>
    linkBase ? dashboardLink(linkBase.url, linkBase.secret, new Date()) : Promise.resolve(null),
  shopkeeperLink: (shopkeeperId: string) =>
    linkBase
      ? shopkeeperLink(linkBase.url, linkBase.secret, { shopkeeperId, now: new Date() })
      : Promise.resolve(null),
};

// M9: the failure alert. Its own send failures are warnings, so an alert that WhatsApp refuses
// never raises another alert.
const opsWatchDeps = {
  ops: createSupabaseOpsRepository(query),
  whatsapp: createWhatsAppClient({
    accessToken: env.META_ACCESS_TOKEN,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
    fetchImpl: fetch,
    log: withoutErrors(log),
  }),
  alertNumber: env.OPS_ALERT_WHATSAPP_NUMBER ?? env.OWNER_WHATSAPP_NUMBER,
  traceLink: (traceId: string) =>
    linkBase
      ? traceLink(linkBase.url, linkBase.secret, { traceId, now: new Date() })
      : Promise.resolve(null),
  clock: () => new Date(),
  log,
};

const deps: WorkerDeps = {
  secret: env.WORKER_SECRET,
  defer,
  process: (callId) => processFollowup(callId, followupDeps),
  // Every minute (pg_cron): follow-ups that are due, and one wake for queued simulated calls
  // (each finished call starts the next, so one wake a minute only recovers a lost chain).
  sweep: () => {
    kickJob(SIMULATION_NEXT_PATH);
    return sweepFollowups(followupDeps);
  },
  nextSimulation: () => runNextSimulation(simulatorDeps),
  dailyAlert: () => sendDailyAlert(jobDeps),
  promiseCheck: () => runPromiseCheck(jobDeps),
  ownerSend: (actionId) => sendOwnerRequest(actionId, ownerSendDeps),
  opsWatch: () => runOpsWatch(opsWatchDeps),
  log,
};

Deno.serve(tracing.serve((req) => handleWorkerRequest(req, deps)));
