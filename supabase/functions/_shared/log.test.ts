// supabase/functions/_shared/log.test.ts
import { assertEquals } from '@std/assert';
import { stub } from '@std/testing/mock';
import { logToConsole } from './log.ts';

Deno.test('logToConsole › writes one JSON line; errors go to stderr', () => {
  const info = stub(console, 'log');
  const error = stub(console, 'error');
  try {
    logToConsole('info', 'tool_call', { tool: 'lookup_loan' });
    logToConsole('error', 'unhandled_error');
    assertEquals(info.calls[0]?.args, [
      '{"level":"info","event":"tool_call","tool":"lookup_loan"}',
    ]);
    assertEquals(error.calls[0]?.args, ['{"level":"error","event":"unhandled_error"}']);
  } finally {
    info.restore();
    error.restore();
  }
});
