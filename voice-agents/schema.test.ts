// voice-agents/schema.test.ts
import { describe, expect, it } from 'vitest';
import { ashaAgent } from './asha/agent.config.ts';
import { AgentConfigSchema, BodyFieldSchema } from './schema.ts';

describe('AgentConfigSchema', () => {
  it('rejects a call cap above 8 minutes (credit guard; Asha is held to 4 in her own test)', () => {
    expect(AgentConfigSchema.safeParse({ ...ashaAgent, maxCallSeconds: 481 }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ ...ashaAgent, maxCallSeconds: 480 }).success).toBe(true);
  });

  it('accepts tool paths on sarvam-tools and munshi-tools only', () => {
    const [tool] = ashaAgent.tools;
    const munshi = { ...ashaAgent, tools: [{ ...tool, path: '/munshi-tools/book_summary' }] };
    expect(AgentConfigSchema.safeParse(munshi).success).toBe(true);
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
