// supabase/functions/_shared/ops/store.ts
// Writes a request's ops events in one database call (M9 Build A). The table is server-only
// (row level security on, no policies); the functions use the service role key.
import type { PostgrestClient } from '../db/postgrest.ts';
import type { OpsEventWriter } from './tracing.ts';

export const OPS_EVENTS_TABLE = 'ops_events';

export function createOpsEventWriter(query: PostgrestClient): OpsEventWriter {
  return async function writeOpsEvents(events): Promise<void> {
    await query('write_ops_events', OPS_EVENTS_TABLE, {
      method: 'POST',
      body: events,
      prefer: 'return=minimal',
    });
  };
}
