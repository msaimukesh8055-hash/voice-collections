// supabase/functions/_shared/env.test.ts
import { assertEquals, assertThrows } from '@std/assert';
import { loadCallsApiEnv, loadServerEnv, loadWebhookEnv, MissingEnvError } from './env.ts';

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

Deno.test('loadWebhookEnv › requires a webhook secret of at least 32 characters', () => {
  assertThrows(() => loadWebhookEnv(VALID_ENV), MissingEnvError, 'VAPI_WEBHOOK_SECRET');
  assertThrows(
    () => loadWebhookEnv({ ...VALID_ENV, VAPI_WEBHOOK_SECRET: 'short' }),
    MissingEnvError,
    'VAPI_WEBHOOK_SECRET',
  );
  const env = loadWebhookEnv({ ...VALID_ENV, VAPI_WEBHOOK_SECRET: 'x'.repeat(32) });
  assertEquals(env.VAPI_WEBHOOK_SECRET.length, 32);
});

Deno.test('loadCallsApiEnv › splits allowed origins into a list', () => {
  const env = loadCallsApiEnv({
    ...VALID_ENV,
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173, http://localhost:4173',
  });
  assertEquals(env.CORS_ALLOWED_ORIGINS, ['http://localhost:5173', 'http://localhost:4173']);
  assertThrows(() => loadCallsApiEnv(VALID_ENV), MissingEnvError, 'CORS_ALLOWED_ORIGINS');
});
