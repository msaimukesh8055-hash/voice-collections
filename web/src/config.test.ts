// web/src/config.test.ts
import { loadBrowserConfig } from './config.ts';

const ENV = {
  VITE_VAPI_PUBLIC_KEY: 'pub-key',
  VITE_SUPABASE_URL: 'https://ref.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_SUPABASE_REGION: 'us-west-2',
};

describe('loadBrowserConfig', () => {
  it('returns public keys, assistant id and the calls API URL', () => {
    const config = loadBrowserConfig(ENV, { assistantId: 'asst_1' });
    expect(config).toEqual({
      vapiPublicKey: 'pub-key',
      assistantId: 'asst_1',
      callsApiUrl: 'https://ref.supabase.co/functions/v1/calls-api',
      supabaseAnonKey: 'anon-key',
      supabaseRegion: 'us-west-2',
    });
  });

  it('fails clearly, naming each missing variable', () => {
    expect(() => loadBrowserConfig({}, { assistantId: 'asst_1' })).toThrow(
      /VITE_VAPI_PUBLIC_KEY.*VITE_SUPABASE_URL.*VITE_SUPABASE_ANON_KEY.*VITE_SUPABASE_REGION/,
    );
  });

  it('fails clearly when the assistant has not been pushed', () => {
    expect(() => loadBrowserConfig(ENV, {})).toThrow('agent:push');
  });
});
