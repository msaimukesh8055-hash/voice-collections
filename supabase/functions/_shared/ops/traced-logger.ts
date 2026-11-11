// supabase/functions/_shared/ops/traced-logger.ts
// The logger every function uses from M9: the same console line as before plus the trace id, and
// one ops event per line on the current trace. Outside a request (module start-up) it is the
// plain logger.
import type { LogFields, Logger, LogLevel } from '../log.ts';
import { currentTrace, type OpsStatus, type OpsStep, recordStep } from './trace.ts';

/** Error codes are short labels; anything longer is cut so a stray message cannot fill a row. */
export const MAX_ERROR_CODE_LENGTH = 120;

const STATUS_OF: Readonly<Record<LogLevel, OpsStatus>> = {
  info: 'ok',
  warn: 'warn',
  error: 'error',
};
/** Where existing log lines keep their timing and their failure label. */
const DURATION_FIELDS = ['ms', 'duration_ms'] as const;
const ERROR_FIELDS = ['code', 'outcome', 'error'] as const;

function firstNumber(fields: LogFields, names: readonly string[]): number | null {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  }
  return null;
}

function firstText(fields: LogFields, names: readonly string[]): string | null {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'string' && value !== '') return value.slice(0, MAX_ERROR_CODE_LENGTH);
  }
  return null;
}

/** One log line as an ops step. A failure label is kept only when the line is not "ok". */
export function toOpsStep(
  line: { level: LogLevel; event: string; fields: LogFields },
  now: Date,
): OpsStep {
  const { level, event, fields } = line;
  const status = STATUS_OF[level];
  return {
    step: event,
    status,
    error_code: status === 'ok' ? null : firstText(fields, ERROR_FIELDS),
    provider: firstText(fields, ['provider']),
    duration_ms: firstNumber(fields, DURATION_FIELDS),
    tokens_in: firstNumber(fields, ['tokens_in']),
    tokens_out: firstNumber(fields, ['tokens_out']),
    detail: fields,
    created_at: now.toISOString(),
  };
}

export function createTracedLogger(base: Logger, clock: () => Date = () => new Date()): Logger {
  return function logTraced(level, event, fields = {}): void {
    const trace = currentTrace();
    if (!trace) return base(level, event, fields);
    base(level, event, { ...fields, trace_id: trace.id });
    recordStep(trace, toOpsStep({ level, event, fields }, clock()));
  };
}
