// supabase/functions/_shared/auth/dashboard-link.test.ts
// The dashboard link token (M6 Decision 9, security: 100% tested).
import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  DASHBOARD_LINK_TTL_MS,
  dashboardLink,
  isValidDashboardToken,
  signDashboardToken,
} from './dashboard-link.ts';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';
const NOW = new Date('2026-11-04T10:00:00Z');

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

Deno.test('dashboard link › a token we signed is valid until it expires (24 h)', async () => {
  const token = await signDashboardToken(SECRET, NOW);
  assertMatch(token, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert(await isValidDashboardToken(token, SECRET, NOW));
  assert(await isValidDashboardToken(token, SECRET, later(DASHBOARD_LINK_TTL_MS - 1000)));
  assertEquals(await isValidDashboardToken(token, SECRET, later(DASHBOARD_LINK_TTL_MS)), false);
});

Deno.test('dashboard link › another secret, a moved expiry or a changed signature is refused', async () => {
  const token = await signDashboardToken(SECRET, NOW);
  const [expires, signature] = token.split('.');
  assertEquals(await isValidDashboardToken(token, `${SECRET}-other`, NOW), false);
  const moved = `${Number(expires) + 86_400}.${signature}`;
  assertEquals(await isValidDashboardToken(moved, SECRET, NOW), false);
  const flipped = `${expires}.${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1)}`;
  assertEquals(await isValidDashboardToken(flipped, SECRET, NOW), false);
});

Deno.test('dashboard link › missing or malformed tokens are refused', async () => {
  for (const token of [null, '', 'abc', '123.', '.abc', `123.${'a'.repeat(44)}`, '1.2.3']) {
    assertEquals(await isValidDashboardToken(token, SECRET, NOW), false, String(token));
  }
});

Deno.test('dashboard link › the link puts the token after "#t=" on the dashboard address', async () => {
  const link = await dashboardLink('http://localhost:5173/', SECRET, NOW);
  assertMatch(link, /^http:\/\/localhost:5173\/#t=\d+\.[A-Za-z0-9_-]{43}$/);
  assert(await isValidDashboardToken(link.split('#t=')[1] ?? null, SECRET, NOW));
});
