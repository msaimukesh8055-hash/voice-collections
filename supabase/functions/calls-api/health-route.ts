// supabase/functions/calls-api/health-route.ts
// GET /v1/health (M9 Build A): is the app API up and can it reach the database? No link token
// and no data, so an uptime checker or the ops page can call it. The required settings are
// checked when the function starts (env.ts), so an answer at all means they are present.
import { jsonResponse } from '../_shared/http.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import type { RouteContext } from './types.ts';

const OK = 200;
/** Monitors read the HTTP status, so "cannot reach the database" must not be a 200. */
const DEGRADED = 503;

export type HealthStatus = 'ok' | 'degraded';

export interface HealthBody {
  readonly status: HealthStatus;
  readonly checks: { readonly database: 'ok' | 'fail' };
  readonly databaseMs: number;
  readonly time: string;
}

export async function getHealth(_req: Request, { deps, cors }: RouteContext): Promise<Response> {
  const started = deps.clock().getTime();
  let database: 'ok' | 'fail' = 'ok';
  try {
    await deps.repo.getDemoSettings();
  } catch (error) {
    database = 'fail';
    deps.log('error', 'health_database_failed', { error: describeFailure(error) });
  }
  const now = deps.clock();
  const body: HealthBody = {
    status: database === 'ok' ? 'ok' : 'degraded',
    checks: { database },
    databaseMs: now.getTime() - started,
    time: now.toISOString(),
  };
  return jsonResponse(body, database === 'ok' ? OK : DEGRADED, cors);
}
