// scripts/lib/agent-choice.ts
// Which voice agent the agent:build / agent:record scripts work on (M8): `--agent asha` (the
// default) or `--agent munshi`. Each agent keeps its config, build folder and Sarvam record.
import { ashaAgent } from '../../voice-agents/asha/agent.config.ts';
import { munshiAgent } from '../../voice-agents/munshi/agent.config.ts';
import type { AgentConfig } from '../../voice-agents/schema.ts';

export const AGENT_NAMES = ['asha', 'munshi'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface AgentChoice {
  readonly name: AgentName;
  readonly config: AgentConfig;
  /** Git-ignored folder for the rendered JSON (it holds the project URL). */
  readonly buildDir: string;
  /** Sarvam app id + committed version, filled by hand after a commit in Sarvam. */
  readonly recordFile: string;
}

const CONFIGS: Readonly<Record<AgentName, AgentConfig>> = {
  asha: ashaAgent,
  munshi: munshiAgent,
};

function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}

/** Reads `--agent <name>` or `--agent=<name>` from the arguments; asha when absent. */
export function chooseAgent(args: readonly string[]): AgentChoice {
  const index = args.findIndex((arg) => arg === '--agent' || arg.startsWith('--agent='));
  const flag = index === -1 ? undefined : args[index];
  const value = flag?.startsWith('--agent=') ? flag.slice('--agent='.length) : args[index + 1];
  const name = index === -1 ? 'asha' : (value ?? '');
  if (!isAgentName(name)) {
    throw new Error(`--agent must be one of: ${AGENT_NAMES.join(', ')}`);
  }
  return {
    name,
    config: CONFIGS[name],
    buildDir: `voice-agents/${name}/build`,
    recordFile: `voice-agents/${name}/sarvam-agent.json`,
  };
}
