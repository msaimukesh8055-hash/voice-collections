// scripts/agent-record.ts
// npm run agent:record — after a version of Asha is committed in Sarvam and its app id and
// version are put in voice-agents/asha/sarvam-agent.json, writes the `publishes` row
// (Sarvam version <-> config hash). Prints ids only, never keys.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ashaAgent } from '../voice-agents/asha/agent.config.ts';
import { buildPublishRow } from './lib/agent-record.ts';
import { renderAgent } from './lib/agent-render.ts';

const RECORD_FILE = 'voice-agents/asha/sarvam-agent.json';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const rendered = renderAgent(ashaAgent, `${supabaseUrl}/functions/v1`);
const record: unknown = JSON.parse(readFileSync(RECORD_FILE, 'utf8'));
const row = buildPublishRow('asha', record, rendered.configHash);
const admin = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
const { error } = await admin
  .from('publishes')
  .upsert(row, { onConflict: 'sarvam_app_id,sarvam_version', ignoreDuplicates: true });
if (error) throw new Error(`Could not record the publish (${error.code})`);
process.stdout.write(
  `Recorded ${row.sarvam_app_id} v${row.sarvam_version} (hash ${row.prompt_hash.slice(0, 12)})\n`,
);
