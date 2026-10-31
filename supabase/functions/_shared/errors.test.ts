// supabase/functions/_shared/errors.test.ts
import { assertEquals, assertNotEquals } from '@std/assert';
import { ERROR_CODES, toClientError } from './errors.ts';

Deno.test('toClientError › maps a known code to its safe message and status', () => {
  // Act
  const result = toClientError('UNAUTHORIZED');
  // Assert
  assertEquals(result, { code: 'UNAUTHORIZED', message: ERROR_CODES.UNAUTHORIZED.message, status: 401 });
});

Deno.test('toClientError › every code has a non-empty message and an HTTP status', () => {
  for (const [code, entry] of Object.entries(ERROR_CODES)) {
    assertNotEquals(entry.message.trim(), '', `${code} has an empty message`);
    assertEquals(entry.status >= 400 && entry.status < 600, true, `${code} status out of range`);
  }
});

Deno.test('toClientError › response shape exposes only code, message and status', () => {
  const result = toClientError('INTERNAL');
  assertEquals(Object.keys(result).sort(), ['code', 'message', 'status']);
});
