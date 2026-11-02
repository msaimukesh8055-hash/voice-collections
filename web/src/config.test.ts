// web/src/config.test.ts
import { loadBrowserConfig } from './config.ts';

const ENV = {
  VITE_SUPABASE_URL: 'https://ref.supabase.co/',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_SUPABASE_REGION: 'ap-south-1',
};

describe('loadBrowserConfig', () => {
  it('returns the public anon key, region and the calls-api URL', () => {
    expect(loadBrowserConfig(ENV)).toEqual({
      appApiUrl: 'https://ref.supabase.co/functions/v1/calls-api',
      anonKey: 'anon-key',
      region: 'ap-south-1',
    });
  });

  it('fails clearly, naming each missing variable', () => {
    expect(() => loadBrowserConfig({})).toThrow(
      /VITE_SUPABASE_URL.*VITE_SUPABASE_ANON_KEY.*VITE_SUPABASE_REGION/,
    );
  });
});
