// supabase/functions/_shared/http.test.ts
import { assertEquals } from '@std/assert';
import { withErrorBoundary } from './http.ts';
import type { LogFields, Logger } from './log.ts';

Deno.test('withErrorBoundary › a non-Error throw still becomes a logged generic 500', async () => {
  const logged: LogFields[] = [];
  const log: Logger = (_level, _event, fields = {}) => logged.push(fields);
  const response = await withErrorBoundary(() => Promise.reject('boom'), log);
  assertEquals(response.status, 500);
  assertEquals(logged[0]?.['error'], 'non-error thrown');
});
