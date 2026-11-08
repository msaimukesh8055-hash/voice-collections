// scripts/agent-build.ts
// npm run agent:build [-- --agent munshi] — validates voice-agents/<agent> (asha by default) and
// writes the JSON to push to Sarvam with the MCP connector: voice-agents/<agent>/build/agent.json
// (git-ignored; holds the project URL). Prints a short summary, never secrets: the tool secret is
// referenced by its vault name only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseAgent } from './lib/agent-choice.ts';
import { renderAgent } from './lib/agent-render.ts';

const agent = chooseAgent(process.argv.slice(2));
const outputFile = `${agent.buildDir}/agent.json`;

const supabaseUrl = process.env['SUPABASE_URL']?.trim().replace(/\/$/, '');
if (!supabaseUrl) throw new Error('Missing SUPABASE_URL in .env');

const rendered = renderAgent(agent.config, `${supabaseUrl}/functions/v1`);
mkdirSync(agent.buildDir, { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(rendered, null, 2)}\n`);
process.stdout.write(
  `Wrote ${outputFile}\n` +
    `  agent: ${rendered.name} | voice ${rendered.voice.name} | ${rendered.languages.join('/')}` +
    ` (starts ${rendered.initialLanguage}) | max ${rendered.maxCallSeconds} s\n` +
    `  tools: ${rendered.tools.map((tool) => tool.name).join(', ')}\n` +
    `  config hash: ${rendered.configHash}\n`,
);
