// scripts/lib/agent-choice.test.ts
import { describe, expect, it } from 'vitest';
import { ashaAgent } from '../../voice-agents/asha/agent.config.ts';
import { munshiAgent } from '../../voice-agents/munshi/agent.config.ts';
import { chooseAgent } from './agent-choice.ts';

describe('chooseAgent', () => {
  it('defaults to Asha', () => {
    const choice = chooseAgent([]);
    expect(choice.name).toBe('asha');
    expect(choice.config).toBe(ashaAgent);
    expect(choice.buildDir).toBe('voice-agents/asha/build');
    expect(choice.recordFile).toBe('voice-agents/asha/sarvam-agent.json');
  });

  it('picks Munshi with --agent munshi or --agent=munshi', () => {
    for (const args of [['--agent', 'munshi'], ['--agent=munshi']]) {
      const choice = chooseAgent(args);
      expect(choice.config).toBe(munshiAgent);
      expect(choice.buildDir).toBe('voice-agents/munshi/build');
      expect(choice.recordFile).toBe('voice-agents/munshi/sarvam-agent.json');
    }
  });

  it('refuses an unknown or missing agent name', () => {
    expect(() => chooseAgent(['--agent', 'ramesh'])).toThrow('--agent must be one of');
    expect(() => chooseAgent(['--agent'])).toThrow('--agent must be one of');
  });
});
