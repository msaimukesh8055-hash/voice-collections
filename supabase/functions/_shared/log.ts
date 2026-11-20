// supabase/functions/_shared/log.ts
// Structured server logs (Supabase function logs). Fields are ids, codes and timings only:
// never names, DOBs, phone numbers, amounts or tool arguments (security.md).

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void;

/** What to log about a caught error: its class name only, never its message (it may hold data). */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export const logToConsole: Logger = (level, event, fields = {}) => {
  const line = JSON.stringify({ level, event, ...fields });
  // deno-lint-ignore no-console -- this module is the single sanctioned console writer
  if (level === 'error') console.error(line);
  // deno-lint-ignore no-console
  else console.log(line);
};
