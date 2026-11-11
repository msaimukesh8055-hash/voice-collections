// supabase/functions/_shared/ops/tracing.ts
// Wires one Edge Function for tracing (M9 Build A). `serve` gives every request a trace and a
// "request" event (route, HTTP status, total time); `defer` keeps background work on the same
// trace; events are written to ops_events after the response, never before it, so a tool reply
// is not slowed by the write. A failed write is logged and dropped: tracing must never fail a
// request.
import type { Logger } from '../log.ts';
import {
  currentTrace,
  drainTrace,
  isTraceId,
  newTrace,
  type OpsEvent,
  type OpsStatus,
  recordStep,
  runInTrace,
  type Trace,
} from './trace.ts';
import { createTracedLogger } from './traced-logger.ts';

/** A function-to-function call (a kick to the follow-up worker) continues the caller's trace. */
export const TRACE_HEADER = 'x-trace-id';
export const REQUEST_STEP = 'request';
/** Path parts longer than a UUID are signed tokens: they are replaced, never stored. */
const MAX_ROUTE_PART_LENGTH = 36;
const HIDDEN_PART = ':token';
const SERVER_ERROR = 500;
const CLIENT_ERROR = 400;

export type OpsEventWriter = (events: readonly OpsEvent[]) => Promise<void>;

export interface TracingConfig {
  /** Function name, e.g. "whatsapp-webhook". */
  readonly source: string;
  readonly write: OpsEventWriter;
  /** Keeps the function alive until the task finishes (EdgeRuntime.waitUntil). */
  readonly waitUntil: (task: Promise<unknown>) => void;
  /** Console logger underneath (logToConsole). */
  readonly baseLog: Logger;
  readonly clock?: () => Date;
  /** Only for functions whose callers are our own functions (the follow-up worker). */
  readonly acceptTraceHeader?: boolean;
}

export interface Tracing {
  readonly log: Logger;
  readonly defer: (task: Promise<unknown>) => void;
  readonly serve: (
    handle: (req: Request) => Promise<Response>,
  ) => (req: Request) => Promise<Response>;
}

/** The path inside the function, with tokens hidden and the query string dropped. */
export function routeOf(req: Request, source: string): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(`/${source}`);
  const inside = start === -1 ? pathname : pathname.slice(start + source.length + 1);
  const parts = inside.split('/').map((part) =>
    part.length > MAX_ROUTE_PART_LENGTH ? HIDDEN_PART : part
  );
  return parts.join('/') || '/';
}

function statusOf(httpStatus: number): OpsStatus {
  if (httpStatus >= SERVER_ERROR) return 'error';
  return httpStatus >= CLIENT_ERROR ? 'warn' : 'ok';
}

function requestStep(
  req: Request,
  outcome: { source: string; httpStatus: number; startedAt: number; now: Date },
): Parameters<typeof recordStep>[1] {
  const status = statusOf(outcome.httpStatus);
  return {
    step: REQUEST_STEP,
    status,
    error_code: status === 'ok' ? null : `HTTP ${outcome.httpStatus}`,
    provider: null,
    duration_ms: outcome.now.getTime() - outcome.startedAt,
    tokens_in: null,
    tokens_out: null,
    detail: {
      method: req.method,
      route: routeOf(req, outcome.source),
      http_status: outcome.httpStatus,
    },
    created_at: outcome.now.toISOString(),
  };
}

export function createTracing(config: TracingConfig): Tracing {
  const clock = config.clock ?? ((): Date => new Date());
  const log = createTracedLogger(config.baseLog, clock);

  async function flush(trace: Trace): Promise<void> {
    const events = drainTrace(trace);
    if (events.length === 0) return;
    try {
      await config.write(events);
    } catch (error) {
      // Console only: logging this through the trace would queue an event for the same failing
      // table.
      const name = error instanceof Error ? error.name : 'unknown';
      config.baseLog('error', 'ops_events_write_failed', { error: name, lost: events.length });
    }
  }

  function startTrace(req: Request): Trace {
    const inherited = config.acceptTraceHeader ? req.headers.get(TRACE_HEADER) : null;
    return isTraceId(inherited) ? newTrace(config.source, inherited) : newTrace(config.source);
  }

  function serve(handle: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
    return function serveTraced(req: Request): Promise<Response> {
      // Browser preflights carry no work and would double every dashboard request.
      if (req.method === 'OPTIONS') return handle(req);
      const trace = startTrace(req);
      const startedAt = clock().getTime();
      return runInTrace(trace, async () => {
        const response = await handle(req);
        const outcome = {
          source: config.source,
          httpStatus: response.status,
          startedAt,
          now: clock(),
        };
        recordStep(trace, requestStep(req, outcome));
        config.waitUntil(flush(trace));
        return response;
      });
    };
  }

  /** Background work started inside a request: its events are written when it finishes. */
  function defer(task: Promise<unknown>): void {
    const trace = currentTrace();
    config.waitUntil(trace ? task.finally(() => flush(trace)) : task);
  }

  return { log, defer, serve };
}
