// supabase/functions/sarvam-tools/index.ts
// Deployed with --no-verify-jwt: Sarvam cannot send a Supabase JWT. The bearer tool secret is
// checked in the handler before anything else. Imports stay lean: the M3 spike saw a 503 on the
// first request after idle, so a small function wakes faster.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadToolsEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { createOpsEventWriter } from '../_shared/ops/store.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { handleToolRequest, type ToolsDeps } from './handler.ts';

/** Supabase Edge Runtime global: keeps the function alive until background work finishes. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const env = loadToolsEnv(Deno.env.toObject());
const query = createPostgrestClient(env);
// M9: every request gets a trace; log lines and background work join it (ops_events).
const tracing = createTracing({
  source: 'sarvam-tools',
  write: createOpsEventWriter(query),
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  baseLog: logToConsole,
});
const log = tracing.log;
const deps: ToolsDeps = {
  repo: createSupabaseRepository(query),
  secret: env.SARVAM_TOOL_SECRET,
  clock: () => new Date(),
  log,
};

Deno.serve(tracing.serve((req) => handleToolRequest(req, deps)));
