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
import { createOpsEventWriter } from '../_shared/ops/store.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { createWhatsAppClient } from '../_shared/whatsapp/client.ts';
import { downloadMedia, uploadMedia } from '../_shared/whatsapp/media.ts';
import { createSpeaker } from '../_shared/speech/tts.ts';
import { createSpokenSummarizer } from '../_shared/whatsapp/spoken-summary.ts';
import { ownerTwinSettings, withEnglishTwin } from '../_shared/whatsapp/english-twin.ts';
import { createTranslator } from '../_shared/speech/translate.ts';
import { dashboardLink, phonePageLink, shopkeeperLink } from '../_shared/auth/dashboard-link.ts';
import { munshiLink, signOwnerCallToken } from '../_shared/auth/owner-call-link.ts';
import { createSupabaseOwnerCallRepository } from '../_shared/db/supabase-owner-call-repository.ts';
import { createTranscriber } from '../_shared/speech/stt.ts';
import { MAX_SIMULATED_AT_ONCE } from '../_shared/calls/queue.ts';
import { createSupabaseFollowupRepository } from '../_shared/db/supabase-followup-repository.ts';
import { createSupabaseReminderRepository } from '../_shared/db/supabase-reminder-repository.ts';
import {
  createJobKicker,
  followupWorkerUrl,
  SIMULATION_NEXT_PATH,
  SWEEP_PATH,
} from '../_shared/followup/kick.ts';
import { handleWebhook, type WebhookDeps } from './handler.ts';
import { type ProcessDeps, processPayload } from './process.ts';

/** Supabase Edge Runtime global: keeps the worker alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadWhatsAppEnv(Deno.env.toObject());

function signedMunshiLink(
  baseUrl: string,
  secret: string,
): (ownerCallId: string) => Promise<string> {
  return async (ownerCallId) => munshiLink(baseUrl, await signOwnerCallToken(secret, ownerCallId));
}
const query = createPostgrestClient(env);
// M9: every request gets a trace; log lines and background work join it (ops_events).
const tracing = createTracing({
  source: 'whatsapp-webhook',
  write: createOpsEventWriter(query),
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  baseLog: logToConsole,
});
const log = tracing.log;
const repo = createSupabaseRepository(query);
const defer = tracing.defer;
const kickJob = createJobKicker({
  workerUrl: followupWorkerUrl(env.SUPABASE_URL),
  secret: env.WORKER_SECRET,
  fetchImpl: fetch,
  log,
  defer,
});
const mediaConfig = {
  accessToken: env.META_ACCESS_TOKEN,
  phoneNumberId: env.META_PHONE_NUMBER_ID,
  fetchImpl: fetch,
  log,
};
const book = createSupabaseBookRepository(query);
const processDeps: ProcessDeps = {
  book,
  // M6: every Telugu reply gets its English underneath when the demo setting is on.
  client: withEnglishTwin(createWhatsAppClient(mediaConfig), {
    translate: createTranslator({
      apiKey: env.SARVAM_API_KEY,
      fetchImpl: fetch,
      log,
    }),
    loadSettings: ownerTwinSettings(book),
    clock: () => new Date(),
  }),
  llm: createBrainLlm({
    sarvamApiKey: env.SARVAM_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    fetchImpl: fetch,
    log,
  }),
  sender: { ownerNumber: env.OWNER_WHATSAPP_NUMBER, hashKey: env.META_APP_SECRET },
  phoneNumberId: env.META_PHONE_NUMBER_ID,
  clock: () => new Date(),
  getDemoSettings: repo.getDemoSettings,
  newPhone: () => randomFakePhone(),
  log,
  reminder: {
    repo,
    store: createSupabaseReminderRepository(query),
    listCallStatuses: createSupabaseFollowupRepository(query).listCallStatuses,
    clock: () => new Date(),
    startSimulations: (count) =>
      kickJob(SIMULATION_NEXT_PATH, Math.min(count, MAX_SIMULATED_AT_ONCE)),
  },
  listen: {
    download: (mediaId) => downloadMedia(mediaConfig, mediaId),
    transcribe: createTranscriber({
      apiKey: env.SARVAM_API_KEY,
      fetchImpl: fetch,
      log,
    }),
  },
  web: {
    uploadImage: (png) =>
      uploadMedia(mediaConfig, { bytes: png, mimeType: 'image/png', fileName: 'insights.png' }),
    dashboardLink: () =>
      env.DASHBOARD_URL && env.DASHBOARD_LINK_SECRET
        ? dashboardLink(env.DASHBOARD_URL, env.DASHBOARD_LINK_SECRET, new Date())
        : Promise.resolve(null),
    shopkeeperLink: (shopkeeperId) =>
      env.DASHBOARD_URL && env.DASHBOARD_LINK_SECRET
        ? shopkeeperLink(env.DASHBOARD_URL, env.DASHBOARD_LINK_SECRET, {
          shopkeeperId,
          now: new Date(),
        })
        : Promise.resolve(null),
    // The phone page is public, but it only answers when the dashboard is set up, so the line
    // follows the same rule as the other links (both settings present).
    phonePageLink: env.DASHBOARD_URL && env.DASHBOARD_LINK_SECRET
      ? phonePageLink(env.DASHBOARD_URL)
      : null,
  },
  voice: {
    summarize: createSpokenSummarizer({
      sarvamApiKey: env.SARVAM_API_KEY,
      fetchImpl: fetch,
      log,
      random: Math.random,
    }),
    speak: createSpeaker({ apiKey: env.SARVAM_API_KEY, fetchImpl: fetch, log }),
    upload: (file) => uploadMedia(mediaConfig, file),
  },
  wakeWorker: () => kickJob(SWEEP_PATH),
  munshi: {
    ownerCalls: createSupabaseOwnerCallRepository(query),
    // The /munshi page lives in the same web app as the dashboard (DASHBOARD_URL).
    link: env.DASHBOARD_URL && env.MUNSHI_LINK_SECRET
      ? signedMunshiLink(env.DASHBOARD_URL, env.MUNSHI_LINK_SECRET)
      : null,
  },
};

const deps: WebhookDeps = {
  verifyToken: env.WHATSAPP_VERIFY_TOKEN,
  appSecret: env.META_APP_SECRET,
  defer,
  process: (payload) => processPayload(payload, processDeps),
  log,
};

Deno.serve(tracing.serve((req) => handleWebhook(req, deps)));
