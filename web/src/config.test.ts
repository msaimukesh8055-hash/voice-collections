// web/src/config.test.ts
import { loadBrowserConfig } from './config.ts';

describe('loadBrowserConfig', () => {
  it('returns the public key and assistant id when both are present', () => {
    const config = loadBrowserConfig(
      { VITE_VAPI_PUBLIC_KEY: 'pub-key' },
      { assistantId: 'asst_1' },
    );
    expect(config).toEqual({ vapiPublicKey: 'pub-key', assistantId: 'asst_1' });
  });

  it('fails clearly when the public key is missing', () => {
    expect(() => loadBrowserConfig({}, { assistantId: 'asst_1' })).toThrow('VITE_VAPI_PUBLIC_KEY');
  });

  it('fails clearly when the assistant has not been pushed', () => {
    expect(() => loadBrowserConfig({ VITE_VAPI_PUBLIC_KEY: 'pub-key' }, {})).toThrow('agent:push');
  });
});
