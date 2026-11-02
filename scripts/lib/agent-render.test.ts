// scripts/lib/agent-render.test.ts
import { describe, expect, it } from 'vitest';
import { ashaAgent } from '../../voice-agents/asha/agent.config.ts';
import { buildPublishRow } from './agent-record.ts';
import { hashConfig, renderAgent } from './agent-render.ts';

const FUNCTIONS_URL = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1';

describe('renderAgent', () => {
  it('turns tool paths into our function URLs with bearer auth by secret name', () => {
    const rendered = renderAgent(ashaAgent, FUNCTIONS_URL);
    expect(rendered.tools[0]).toMatchObject({
      name: 'confirm_identity',
      url: `${FUNCTIONS_URL}/sarvam-tools/confirm_identity`,
      method: 'POST',
      auth: { type: 'bearer', secretName: 'easy-recovery-tool-secret' },
      headers: {},
      respTemplate: '{{say}}',
      timeoutSeconds: 10,
    });
    expect(rendered.tools.map((tool) => tool.name)).toHaveLength(5);
    expect(JSON.stringify(rendered)).not.toContain('"path"');
    expect(JSON.stringify(rendered)).not.toContain('toolSecretName');
  });

  it('carries voice, languages, cap and variables, plus a stable hash', () => {
    const rendered = renderAgent(ashaAgent, FUNCTIONS_URL);
    expect(rendered.voice.internalId).toBe('01a0cf16-897b-76f8-8de9-34f27e861df6');
    expect([rendered.initialLanguage, rendered.maxCallSeconds]).toEqual(['Telugu', 240]);
    expect(rendered.agentVariables.map((variable) => variable.name)).toContain('call_token');
    expect(rendered.configHash).toBe(renderAgent(ashaAgent, FUNCTIONS_URL).configHash);
    expect(rendered.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an invalid config or a malformed functions URL', () => {
    expect(() => renderAgent({ ...ashaAgent, maxCallSeconds: 900 }, FUNCTIONS_URL)).toThrow();
    expect(() => renderAgent(ashaAgent, 'http://localhost/functions')).toThrow('functionsUrl');
  });

  it('hashes any change to what Sarvam receives', () => {
    expect(hashConfig({ a: 1 })).not.toBe(hashConfig({ a: 2 }));
  });
});

describe('buildPublishRow', () => {
  it('records the app id, committed version and config hash', () => {
    const row = buildPublishRow('asha', { appId: 'Asha-1', committedVersion: 2 }, 'h');
    expect(row).toEqual({
      agent: 'asha',
      prompt_hash: 'h',
      sarvam_app_id: 'Asha-1',
      sarvam_version: 2,
    });
  });

  it('refuses a record with no app or no committed version yet', () => {
    expect(() => buildPublishRow('asha', { appId: null, committedVersion: null }, 'h')).toThrow(
      'create the agent in Sarvam first',
    );
    expect(() => buildPublishRow('asha', { appId: 'Asha-1', committedVersion: 0 }, 'h')).toThrow(
      'committed Sarvam version',
    );
  });
});
