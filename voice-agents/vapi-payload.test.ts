// voice-agents/vapi-payload.test.ts
import { describe, expect, it } from 'vitest';
import { collectionsAgent } from './collections/assistant.config.ts';
import { VAPI_SECRET_HEADER } from '../supabase/functions/_shared/vapi.ts';
import { REGION_HEADER } from '../supabase/functions/_shared/region.ts';
import {
  buildAssistantPayload,
  buildCallOverrides,
  buildServerSettings,
  buildVariantOverrides,
} from './vapi-payload.ts';

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

  it('clears the old idle-message setting and uses the English silence hook by default', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.messagePlan).toEqual({ idleMessages: [] });
    expect(payload.hooks[0]?.do[0]?.exact).toEqual([collectionsAgent.variants.en.idleMessage]);
  });

  it('carries the interruption settings and the call-length cap', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.stopSpeakingPlan).toEqual(collectionsAgent.interruption);
    expect(payload.maxDurationSeconds).toBe(240);
  });

  it('gives the model the collections tools plus the built-in end-call tool', () => {
    const payload = buildAssistantPayload(collectionsAgent);
    expect(payload.model.tools).toEqual([...collectionsAgent.tools, { type: 'endCall' }]);
  });

  it('never contains a key or secret field', () => {
    const serialised = JSON.stringify(buildAssistantPayload(collectionsAgent)).toLowerCase();
    expect(serialised).not.toMatch(/apikey|api_key|secret|password|token/);
  });
});

describe('buildServerSettings', () => {
  const settings = buildServerSettings({
    url: 'https://ref.supabase.co/functions/v1/vapi-webhook',
    secret: 's3cret',
    region: 'us-west-2',
  });

  it('points tool calls at the webhook with the shared secret, pinned to the database region', () => {
    expect(settings.server.url).toBe('https://ref.supabase.co/functions/v1/vapi-webhook');
    expect(settings.server.headers).toEqual({
      [VAPI_SECRET_HEADER]: 's3cret',
      [REGION_HEADER]: 'us-west-2',
    });
  });

  it('fails fast on a slow tool and only subscribes to tool calls in M2', () => {
    expect(settings.server.timeoutSeconds).toBeLessThanOrEqual(10);
    expect(settings.serverMessages).toEqual(['tool-calls']);
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
    expect(overrides.hooks).toEqual([
      {
        name: 'idle_hi',
        on: 'customer.speech.timeout',
        options: { timeoutSeconds: 8, triggerMaxCount: 1, triggerResetMode: 'never' },
        do: [{ type: 'say', exact: [hindi.idleMessage] }],
      },
    ]);
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

describe('buildCallOverrides', () => {
  it('adds the call token as metadata and the per-call variables to the language settings', () => {
    const call = { callToken: 'token-1', customerName: 'Ravi Sharma', today: 'Sunday, 2026-11-01' };
    const overrides = buildCallOverrides(collectionsAgent, 'hi', call);
    expect(overrides.metadata).toEqual({ callToken: 'token-1' });
    expect(overrides.variableValues).toEqual({
      ...collectionsAgent.variants.hi.promptVariables,
      customerName: 'Ravi Sharma',
      today: 'Sunday, 2026-11-01',
    });
    expect(overrides.variableValues['callLanguage']).toBe('Hindi');
    expect(overrides.voice).toEqual(collectionsAgent.variants.hi.voice);
  });
});
