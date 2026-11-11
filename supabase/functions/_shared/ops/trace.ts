// supabase/functions/_shared/ops/trace.ts
// One trace per request (M9 Build A): every log line written while a request is handled, and in
// the background work it starts, carries the same trace id and is kept as an ops event. The
// current trace travels with the async call chain (AsyncLocalStorage), so no function signature
// changes. Events hold what logs hold: ids, codes and timings only (security.md).
import { AsyncLocalStorage } from 'node:async_hooks';

export type OpsStatus = 'ok' | 'warn' | 'error';

export interface OpsEvent {
  readonly trace_id: string;
  readonly source: string;
  readonly step: string;
  readonly status: OpsStatus;
  readonly error_code: string | null;
  readonly provider: string | null;
  readonly duration_ms: number | null;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
  readonly created_at: string;
}

/** What a step reports; the trace adds its own id and source. */
export type OpsStep = Omit<OpsEvent, 'trace_id' | 'source'>;

export interface Trace {
  readonly id: string;
  readonly source: string;
  /** Events not yet written; emptied by drainTrace. The one deliberately mutable buffer. */
  readonly pending: OpsEvent[];
}

/** A runaway loop must not grow one trace without limit; later events only reach the console. */
export const MAX_EVENTS_PER_TRACE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storage = new AsyncLocalStorage<Trace>();

export function isTraceId(value: string | null): value is string {
  return value !== null && UUID.test(value);
}

export function newTrace(source: string, id: string = crypto.randomUUID()): Trace {
  return { id, source, pending: [] };
}

/** Runs `work` with `trace` as the current trace for everything it awaits or starts. */
export function runInTrace<T>(trace: Trace, work: () => T): T {
  return storage.run(trace, work);
}

export function currentTrace(): Trace | null {
  return storage.getStore() ?? null;
}

/** Adds one step to `trace`; false when the trace is full. */
export function recordStep(trace: Trace, step: OpsStep): boolean {
  if (trace.pending.length >= MAX_EVENTS_PER_TRACE) return false;
  trace.pending.push({ ...step, trace_id: trace.id, source: trace.source });
  return true;
}

/** The events waiting to be written; the trace starts collecting afresh. */
export function drainTrace(trace: Trace): readonly OpsEvent[] {
  return trace.pending.splice(0, trace.pending.length);
}
