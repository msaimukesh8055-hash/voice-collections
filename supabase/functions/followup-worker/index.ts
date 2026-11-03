// supabase/functions/followup-worker/index.ts
// Deployed with --no-verify-jwt: calls-api and pg_cron call it with WORKER_SECRET (checked in
// the handler before anything else), not a Supabase JWT.
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
import { createTranscriptClient } from '../_shared/sarvam-analytics.ts';
import { createWhatsAppClient } from '../_shared/whatsapp/client.ts';
import { handleWorkerRequest, type WorkerDeps } from './handler.ts';

/** Supabase Edge Runtime global: keeps the worker alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadWorkerEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
const defer = (task: Promise<unknown>): void => EdgeRuntime.waitUntil(task);
const kickerConfig = {
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log: logToConsole,
  defer,
};
const kick = createFollowupKicker(kickerConfig);
const kickJob = createJobKicker(kickerConfig);
const llmConfig: JsonLlmConfig = {
  sarvamApiKey: env.SARVAM_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  fetchImpl: fetch,
  log: logToConsole,
};

const followupDeps: FollowupDeps = {
  repo: createSupabaseRepository(query),
  followups: createSupabaseFollowupRepository(query),
  book: createSupabaseBookRepository(query),
  llm: createJsonLlm(llmConfig),
  transcripts: createTranscriptClient({
    apiKey: env.SARVAM_AGENTS_API_KEY,
    orgId: env.SARVAM_ORG_ID,
    workspaceId: env.SARVAM_WORKSPACE_ID,
    appId: env.SARVAM_APP_ID,
    fetchImpl: fetch,
    log: logToConsole,
  }),
  whatsapp: createWhatsAppClient({
    accessToken: env.META_ACCESS_TOKEN,
    phoneNumberId: env.META_PHONE_NUMBER_ID,
    fetchImpl: fetch,
    log: logToConsole,
  }),
  owner: { ownerNumber: env.OWNER_WHATSAPP_NUMBER, hashKey: env.META_APP_SECRET },
  clock: () => new Date(),
  log: logToConsole,
  requeue: (callId) => kick(callId, RETRY_DELAY_MS),
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
  log: logToConsole,
  kickFollowup: (callId) => kick(callId),
  startNext: () => kickJob(SIMULATION_NEXT_PATH),
};
const jobDeps = { ...followupDeps, store };

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
  log: logToConsole,
};

Deno.serve((req) => handleWorkerRequest(req, deps));
