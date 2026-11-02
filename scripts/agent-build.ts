// scripts/agent-build.ts
// npm run agent:build — validates voice-agents/asha and writes the JSON to push to Sarvam with
// the MCP connector: voice-agents/asha/build/agent.json (git-ignored; holds the project URL).
// Prints a short summary, never secrets: the tool secret is referenced by its vault name only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ashaAgent } from '../voice-agents/asha/agent.config.ts';
import { renderAgent } from './lib/agent-render.ts';

const OUTPUT_DIR = 'voice-agents/asha/build';
const OUTPUT_FILE = `${OUTPUT_DIR}/agent.json`;

const supabaseUrl = process.env['SUPABASE_URL']?.trim().replace(/\/$/, '');
if (!supabaseUrl) throw new Error('Missing SUPABASE_URL in .env');

const rendered = renderAgent(ashaAgent, `${supabaseUrl}/functions/v1`);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, `${JSON.stringify(rendered, null, 2)}\n`);
process.stdout.write(
  `Wrote ${OUTPUT_FILE}\n` +
    `  agent: ${rendered.name} | voice ${rendered.voice.name} | ${rendered.languages.join('/')}` +
    ` (starts ${rendered.initialLanguage}) | max ${rendered.maxCallSeconds} s\n` +
    `  tools: ${rendered.tools.map((tool) => tool.name).join(', ')}\n` +
    `  config hash: ${rendered.configHash}\n`,
);
