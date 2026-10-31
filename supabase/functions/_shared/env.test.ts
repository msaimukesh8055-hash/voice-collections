// supabase/functions/_shared/env.test.ts
import { assertEquals, assertThrows } from '@std/assert';
import { loadServerEnv, MissingEnvError } from './env.ts';

const VALID_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

Deno.test('loadServerEnv › accepts a complete env and returns typed values', () => {
  // Arrange + Act
  const env = loadServerEnv(VALID_ENV);
  // Assert
  assertEquals(env.SUPABASE_URL, 'https://example.supabase.co');
});

Deno.test('loadServerEnv › rejects a missing required variable', () => {
  const { SUPABASE_SERVICE_ROLE_KEY: _omitted, ...incomplete } = VALID_ENV;
  assertThrows(() => loadServerEnv(incomplete), MissingEnvError, 'SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('loadServerEnv › rejects a blank variable', () => {
  assertThrows(() => loadServerEnv({ ...VALID_ENV, SUPABASE_URL: '' }), MissingEnvError);
});

Deno.test('loadServerEnv › rejects a malformed URL', () => {
  assertThrows(() => loadServerEnv({ ...VALID_ENV, SUPABASE_URL: 'not-a-url' }), MissingEnvError);
});

Deno.test('loadServerEnv › error message never contains secret values', () => {
  const error = assertThrows(
    () => loadServerEnv({ SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_ROLE_KEY: 'super-secret' }),
    MissingEnvError,
  );
  assertEquals(error.message.includes('super-secret'), false);
});
