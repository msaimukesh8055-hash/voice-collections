// supabase/functions/_shared/env.test.ts
import { assertEquals, assertThrows } from '@std/assert';
import {
  loadCallsApiEnv,
  loadOwnerToolsEnv,
  loadServerEnv,
  loadToolsEnv,
  loadWhatsAppEnv,
  loadWorkerEnv,
  MissingEnvError,
} from './env.ts';

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
  WORKER_SECRET: 'w'.repeat(32),
  DASHBOARD_LINK_SECRET: 'd'.repeat(32),
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

const WHATSAPP_ENV = {
  ...VALID_ENV,
  META_ACCESS_TOKEN: 'meta-token',
  META_PHONE_NUMBER_ID: '100000000000001',
  META_APP_SECRET: 'app-secret',
  WHATSAPP_VERIFY_TOKEN: 'verify-token',
  OWNER_WHATSAPP_NUMBER: '+91 00000 99999',
  SARVAM_API_KEY: 'sarvam-key',
  GEMINI_API_KEY: 'gemini-key',
  WORKER_SECRET: 'w'.repeat(32),
};

Deno.test('loadWhatsAppEnv › keeps only the digits of the owner number', () => {
  assertEquals(loadWhatsAppEnv(WHATSAPP_ENV).OWNER_WHATSAPP_NUMBER, '910000099999');
});

Deno.test('loadWhatsAppEnv › rejects a short owner number without echoing it', () => {
  const error = assertThrows(
    () => loadWhatsAppEnv({ ...WHATSAPP_ENV, OWNER_WHATSAPP_NUMBER: '12345' }),
    MissingEnvError,
    'OWNER_WHATSAPP_NUMBER',
  );
  assertEquals(error.message.includes('12345'), false);
});

Deno.test('loadWhatsAppEnv › requires the app secret and a numeric phone number id', () => {
  const { META_APP_SECRET: _omitted, ...incomplete } = WHATSAPP_ENV;
  assertThrows(() => loadWhatsAppEnv(incomplete), MissingEnvError, 'META_APP_SECRET');
  assertThrows(
    () => loadWhatsAppEnv({ ...WHATSAPP_ENV, META_PHONE_NUMBER_ID: 'abc' }),
    MissingEnvError,
    'META_PHONE_NUMBER_ID',
  );
});

Deno.test('loadCallsApiEnv › requires a worker secret of 32+ characters', () => {
  const { WORKER_SECRET: _secret, ...withoutSecret } = CALLS_API_ENV;
  assertThrows(() => loadCallsApiEnv(withoutSecret), MissingEnvError, 'WORKER_SECRET');
  assertThrows(
    () => loadCallsApiEnv({ ...CALLS_API_ENV, WORKER_SECRET: 'short' }),
    MissingEnvError,
    'WORKER_SECRET',
  );
});

const WORKER_ENV = {
  ...CALLS_API_ENV,
  META_ACCESS_TOKEN: 'meta-token',
  META_PHONE_NUMBER_ID: '123456789',
  META_APP_SECRET: 'app-secret',
  OWNER_WHATSAPP_NUMBER: '+91 00000 99999',
  SARVAM_API_KEY: 'sarvam-key',
  GEMINI_API_KEY: 'gemini-key',
};

Deno.test('loadWorkerEnv › needs the worker secret, Sarvam, Meta and LLM keys, not CORS', () => {
  const { CORS_ALLOWED_ORIGINS: _cors, ...withoutCors } = WORKER_ENV;
  const env = loadWorkerEnv(withoutCors);
  assertEquals([env.OWNER_WHATSAPP_NUMBER, env.SARVAM_APP_ID], ['910000099999', 'app-1']);
  const { GEMINI_API_KEY: _gemini, ...withoutGemini } = withoutCors;
  assertThrows(() => loadWorkerEnv(withoutGemini), MissingEnvError, 'GEMINI_API_KEY');
  assertThrows(
    () => loadWorkerEnv({ ...withoutCors, META_PHONE_NUMBER_ID: 'abc' }),
    MissingEnvError,
    'META_PHONE_NUMBER_ID',
  );
});

Deno.test('loadWhatsAppEnv › needs the worker secret to start simulated calls (M5 5b)', () => {
  const { WORKER_SECRET: _secret, ...withoutSecret } = WHATSAPP_ENV;
  assertThrows(() => loadWhatsAppEnv(withoutSecret), MissingEnvError, 'WORKER_SECRET');
});

Deno.test('env › calls-api needs a dashboard link secret of 32+ characters (M6)', () => {
  const short = { ...CALLS_API_ENV, DASHBOARD_LINK_SECRET: 'short' };
  assertThrows(() => loadCallsApiEnv(short), MissingEnvError, 'DASHBOARD_LINK_SECRET');
});

Deno.test('env › the bot\'s dashboard settings are optional; blank means "not set up"', () => {
  const none = loadWhatsAppEnv(WHATSAPP_ENV);
  assertEquals([none.DASHBOARD_URL, none.DASHBOARD_LINK_SECRET], [null, null]);
  const set = loadWhatsAppEnv({
    ...WHATSAPP_ENV,
    DASHBOARD_URL: 'http://localhost:5173',
    DASHBOARD_LINK_SECRET: 'd'.repeat(32),
  });
  assertEquals(set.DASHBOARD_URL, 'http://localhost:5173');
  const bad = { ...WHATSAPP_ENV, DASHBOARD_URL: 'not a url' };
  assertThrows(() => loadWhatsAppEnv(bad), MissingEnvError, 'DASHBOARD_URL');
});

const OWNER_SECRET = 'o'.repeat(32);

Deno.test('loadOwnerToolsEnv › needs its own tool secret of 32+ characters (M8)', () => {
  assertThrows(() => loadOwnerToolsEnv(VALID_ENV), MissingEnvError, 'SARVAM_OWNER_TOOL_SECRET');
  assertThrows(
    () => loadOwnerToolsEnv({ ...VALID_ENV, SARVAM_OWNER_TOOL_SECRET: 'short' }),
    MissingEnvError,
    'SARVAM_OWNER_TOOL_SECRET',
  );
  const env = loadOwnerToolsEnv({
    ...VALID_ENV,
    SARVAM_OWNER_TOOL_SECRET: OWNER_SECRET,
    WORKER_SECRET: 'w'.repeat(32),
  });
  assertEquals(env.SARVAM_OWNER_TOOL_SECRET, OWNER_SECRET);
});

Deno.test('loadOwnerToolsEnv › needs WORKER_SECRET to kick the WhatsApp send job (M8 B5)', () => {
  const base = { ...VALID_ENV, SARVAM_OWNER_TOOL_SECRET: OWNER_SECRET };
  assertThrows(() => loadOwnerToolsEnv(base), MissingEnvError, 'WORKER_SECRET');
  assertThrows(
    () => loadOwnerToolsEnv({ ...base, WORKER_SECRET: 'short' }),
    MissingEnvError,
    'WORKER_SECRET',
  );
  assertEquals(
    loadOwnerToolsEnv({ ...base, WORKER_SECRET: 'w'.repeat(32) }).WORKER_SECRET,
    'w'.repeat(32),
  );
});

Deno.test("loadOwnerToolsEnv › refuses to start when the owner secret is Asha's secret", () => {
  const same = {
    ...VALID_ENV,
    SARVAM_OWNER_TOOL_SECRET: OWNER_SECRET,
    SARVAM_TOOL_SECRET: OWNER_SECRET,
    WORKER_SECRET: 'w'.repeat(32),
  };
  const error = assertThrows(
    () => loadOwnerToolsEnv(same),
    MissingEnvError,
    'SARVAM_OWNER_TOOL_SECRET',
  );
  assertEquals(error.message.includes(OWNER_SECRET), false);
  const differ = { ...same, SARVAM_TOOL_SECRET: 'a'.repeat(32) };
  assertEquals(loadOwnerToolsEnv(differ).SARVAM_TOOL_SECRET, 'a'.repeat(32));
});

Deno.test('env › Munshi settings are optional; blank means "not set up" (M8)', () => {
  const bot = loadWhatsAppEnv(WHATSAPP_ENV);
  assertEquals(bot.MUNSHI_LINK_SECRET, null);
  const api = loadCallsApiEnv(CALLS_API_ENV);
  assertEquals([api.MUNSHI_LINK_SECRET, api.SARVAM_MUNSHI_APP_ID], [null, null]);
  const set = loadCallsApiEnv({
    ...CALLS_API_ENV,
    MUNSHI_LINK_SECRET: 'm'.repeat(32),
    SARVAM_MUNSHI_APP_ID: 'Munshi-1',
  });
  assertEquals([set.MUNSHI_LINK_SECRET, set.SARVAM_MUNSHI_APP_ID], ['m'.repeat(32), 'Munshi-1']);
  assertThrows(
    () => loadWhatsAppEnv({ ...WHATSAPP_ENV, MUNSHI_LINK_SECRET: 'short' }),
    MissingEnvError,
    'MUNSHI_LINK_SECRET',
  );
});
