// voice-agents/schema.test.ts
import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from './schema.ts';
import { collectionsAgent } from './collections/assistant.config.ts';

describe('AgentConfigSchema', () => {
  it('accepts the collections agent config', () => {
    expect(AgentConfigSchema.safeParse(collectionsAgent).success).toBe(true);
  });

  it('rejects a config whose language variant has an empty greeting', () => {
    const broken = {
      ...collectionsAgent,
      variants: {
        ...collectionsAgent.variants,
        en: { ...collectionsAgent.variants.en, firstMessage: ' ' },
      },
    };
    expect(AgentConfigSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an unknown language variant', () => {
    const broken = {
      ...collectionsAgent,
      variants: { ...collectionsAgent.variants, te: collectionsAgent.variants.en },
    };
    expect(AgentConfigSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a call cap above the spike budget limit', () => {
    const broken = { ...collectionsAgent, maxDurationSeconds: 3600 };
    expect(AgentConfigSchema.safeParse(broken).success).toBe(false);
  });
});
