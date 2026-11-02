// voice-agents/schema.test.ts
import { describe, expect, it } from 'vitest';
import { ashaAgent } from './asha/agent.config.ts';
import { AgentConfigSchema, BodyFieldSchema } from './schema.ts';

describe('AgentConfigSchema', () => {
  it('rejects a call cap above 4 minutes (credit guard)', () => {
    expect(AgentConfigSchema.safeParse({ ...ashaAgent, maxCallSeconds: 241 }).success).toBe(false);
  });

  it('rejects a tool path outside sarvam-tools', () => {
    const [tool] = ashaAgent.tools;
    const config = { ...ashaAgent, tools: [{ ...tool, path: '/elsewhere/get_dues' }] };
    expect(AgentConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects an unknown language and a body field with no source', () => {
    expect(AgentConfigSchema.safeParse({ ...ashaAgent, initialLanguage: 'Tamil' }).success).toBe(
      false,
    );
    expect(BodyFieldSchema.safeParse({ key: 'amount' }).success).toBe(false);
  });
});
