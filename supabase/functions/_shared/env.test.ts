// supabase/functions/_shared/env.test.ts
import { assertEquals, assertThrows } from '@std/assert';
import { loadCallsApiEnv, loadServerEnv, loadToolsEnv, MissingEnvError } from './env.ts';

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

Deno.test('loadToolsEnv › requires a tool secret of at least 32 characters', () => {
  assertThrows(() => loadToolsEnv(VALID_ENV), MissingEnvError, 'SARVAM_TOOL_SECRET');
  assertThrows(
    () => loadToolsEnv({ ...VALID_ENV, SARVAM_TOOL_SECRET: 'short' }),
    MissingEnvError,
    'SARVAM_TOOL_SECRET',
  );
  const env = loadToolsEnv({ ...VALID_ENV, SARVAM_TOOL_SECRET: 'x'.repeat(32) });
  assertEquals(env.SARVAM_TOOL_SECRET.length, 32);
});

const CALLS_API_ENV = {
  ...VALID_ENV,
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173, http://localhost:4173',
  SARVAM_AGENTS_API_KEY: 'agents-key',
  SARVAM_ORG_ID: 'org-1',
  SARVAM_WORKSPACE_ID: 'ws-1',
  SARVAM_APP_ID: 'app-1',
};

Deno.test('loadCallsApiEnv › splits allowed origins into a list', () => {
  const env = loadCallsApiEnv(CALLS_API_ENV);
  assertEquals(env.CORS_ALLOWED_ORIGINS, ['http://localhost:5173', 'http://localhost:4173']);
  assertThrows(() => loadCallsApiEnv(VALID_ENV), MissingEnvError, 'CORS_ALLOWED_ORIGINS');
});

Deno.test('loadCallsApiEnv › requires the Sarvam agents key, org and workspace', () => {
  const { SARVAM_AGENTS_API_KEY: _key, ...withoutKey } = CALLS_API_ENV;
  assertThrows(() => loadCallsApiEnv(withoutKey), MissingEnvError, 'SARVAM_AGENTS_API_KEY');
});

Deno.test('loadCallsApiEnv › a blank or missing app id means "not set up yet" (null)', () => {
  assertEquals(loadCallsApiEnv({ ...CALLS_API_ENV, SARVAM_APP_ID: ' ' }).SARVAM_APP_ID, null);
  const { SARVAM_APP_ID: _app, ...withoutApp } = CALLS_API_ENV;
  assertEquals(loadCallsApiEnv(withoutApp).SARVAM_APP_ID, null);
  assertEquals(loadCallsApiEnv(CALLS_API_ENV).SARVAM_APP_ID, 'app-1');
});
