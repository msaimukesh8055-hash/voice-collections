// agent/vapi-payload.test.ts
import { describe, expect, it } from 'vitest';
import { collectionsAgent } from './collections/assistant.config.ts';
import { buildAssistantPayload, buildVariantOverrides } from './vapi-payload.ts';

describe('buildAssistantPayload', () => {
  it('uses the voice model with the system prompt as the first message', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.model).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(payload.model.messages[0]).toEqual({
      role: 'system',
      content: collectionsAgent.systemPrompt,
    });
  });

  it('applies the default variant speech settings and greeting', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.firstMessage).toBe(collectionsAgent.variants.en.firstMessage);
    expect(payload.voice).toEqual(collectionsAgent.variants.en.voice);
  });

  it('carries the interruption settings and the call-length cap', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.stopSpeakingPlan).toEqual(collectionsAgent.interruption);
    expect(payload.maxDurationSeconds).toBe(120);
  });

  it('never contains a key or secret field', () => {
    const serialised = JSON.stringify(buildAssistantPayload(collectionsAgent)).toLowerCase();
    expect(serialised).not.toMatch(/apikey|api_key|secret|password|token/);
  });
});

describe('buildVariantOverrides', () => {
  it('switches transcriber, voice and fixed lines to the chosen language', () => {
    const overrides = buildVariantOverrides(collectionsAgent, 'hi');
    const hindi = collectionsAgent.variants.hi;
    expect(overrides).toMatchObject({
      transcriber: hindi.transcriber,
      voice: hindi.voice,
      firstMessage: hindi.firstMessage,
      endCallMessage: hindi.endCallMessage,
    });
    expect(overrides.messagePlan.idleMessages).toEqual([hindi.idleMessage]);
  });

  it('replies sooner after Hindi speech than English (Hindi transcripts lack punctuation)', () => {
    function waitFor(variantId: 'en' | 'hi'): number {
      return buildVariantOverrides(collectionsAgent, variantId).startSpeakingPlan
        .transcriptionEndpointingPlan.onNoPunctuationSeconds;
    }
    expect(waitFor('en')).toBe(1.5);
    expect(waitFor('hi')).toBe(0.8);
  });
});
