// supabase/functions/sarvam-tools/index.ts
// Deployed with --no-verify-jwt: Sarvam cannot send a Supabase JWT. The bearer tool secret is
// checked in the handler before anything else. Imports stay lean: the M3 spike saw a 503 on the
// first request after idle, so a small function wakes faster.
import { createPostgrestClient } from '../_shared/db/postgrest.ts';
import { createSupabaseRepository } from '../_shared/db/supabase-repository.ts';
import { loadToolsEnv } from '../_shared/env.ts';
import { logToConsole } from '../_shared/log.ts';
import { handleToolRequest, type ToolsDeps } from './handler.ts';

const env = loadToolsEnv(Deno.env.toObject());
const deps: ToolsDeps = {
  repo: createSupabaseRepository(createPostgrestClient(env)),
  secret: env.SARVAM_TOOL_SECRET,
  clock: () => new Date(),
  log: logToConsole,
};

Deno.serve((req) => handleToolRequest(req, deps));
