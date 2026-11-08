// scripts/agent-record.ts
// npm run agent:record [-- --agent munshi] — after a version of the agent (asha by default) is
// committed in Sarvam and its app id and version are put in voice-agents/<agent>/sarvam-agent.json,
// writes the `publishes` row (Sarvam version <-> config hash). Prints ids only, never keys.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chooseAgent } from './lib/agent-choice.ts';
import { buildPublishRow } from './lib/agent-record.ts';
import { renderAgent } from './lib/agent-render.ts';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const agent = chooseAgent(process.argv.slice(2));
const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const rendered = renderAgent(agent.config, `${supabaseUrl}/functions/v1`);
const record: unknown = JSON.parse(readFileSync(agent.recordFile, 'utf8'));
const row = buildPublishRow(agent.name, record, rendered.configHash);
const admin = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
const { error } = await admin
  .from('publishes')
  .upsert(row, { onConflict: 'sarvam_app_id,sarvam_version', ignoreDuplicates: true });
if (error) throw new Error(`Could not record the publish (${error.code})`);
process.stdout.write(
  `Recorded ${row.sarvam_app_id} v${row.sarvam_version} (hash ${row.prompt_hash.slice(0, 12)})\n`,
);
