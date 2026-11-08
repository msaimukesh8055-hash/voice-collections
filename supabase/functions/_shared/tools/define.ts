// supabase/functions/_shared/tools/define.ts
// The validate → run → catch wrapper every tool registry uses (split out of registry.ts in M8, so
// Munshi's registry reuses it without loading Asha's tools). Validation happens here once, so a
// tool gets parsed arguments, and the audit trail only ever sees arguments that passed
// validation, never raw LLM output (CP1 H1). A registry gives its context type, its refusal
// codes and its own wording for the two built-in refusals.
import type { z } from 'zod';
import { RepositoryError } from '../db/postgrest.ts';
import type { ToolContext, ToolErrorCode, ToolOutcome } from './types.ts';

/** Stored in tool_events in place of arguments that cannot be trusted. */
export const AUDIT_MARKERS = {
  invalid: '[invalid]',
  unknownTool: '[unknown tool]',
  /** A refused call's arguments are never validated, so they are not kept. */
  notAuthorised: '[not authorised]',
} as const;

/** A tool's outcome plus what the audit row may store. `failure` is set when the tool threw
 * (e.g. a database timeout): operation and error code only, safe to log. */
export interface ToolRun<C extends string = ToolErrorCode> extends ToolOutcome<C> {
  readonly auditArgs: unknown;
  readonly failure?: string;
}

export interface RegisteredTool<Ctx = ToolContext, C extends string = ToolErrorCode> {
  run(ctx: Ctx, rawArgs: unknown): Promise<ToolRun<C>>;
}

/** How a registry words its two built-in refusals (bad arguments, a thrown error). */
export interface ToolFailures<C extends string> {
  readonly invalidArgs: (detail: string) => ToolOutcome<C>;
  readonly temporaryError: () => ToolOutcome<C>;
}

export type ToolDefiner<Ctx, C extends string> = <S extends z.ZodType>(
  schema: S,
  handler: (ctx: Ctx, args: z.infer<S>) => Promise<ToolOutcome<C>>,
) => RegisteredTool<Ctx, C>;

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.map((issue) =>
    `${issue.path.join('.') || 'arguments'}: ${issue.message}`
  );
  return `Invalid arguments. ${issues.join('; ')}`;
}

/** RepositoryError messages carry only the operation and code; any other error gives just its
 * name, since its message could quote data. */
export function describeFailure(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return error instanceof Error ? error.name : 'unknown error';
}

/** The validate → run → catch wrapper, for a registry with context `Ctx` and codes `C`. */
export function defineToolWith<Ctx, C extends string>(
  failures: ToolFailures<C>,
): ToolDefiner<Ctx, C> {
  return function defineTool<S extends z.ZodType>(
    schema: S,
    handler: (ctx: Ctx, args: z.infer<S>) => Promise<ToolOutcome<C>>,
  ): RegisteredTool<Ctx, C> {
    return {
      async run(ctx, rawArgs): Promise<ToolRun<C>> {
        const parsed = schema.safeParse(rawArgs);
        if (!parsed.success) {
          const invalid = failures.invalidArgs(describeIssues(parsed.error));
          return { ...invalid, auditArgs: AUDIT_MARKERS.invalid };
        }
        const auditArgs = parsed.data;
        try {
          return { ...(await handler(ctx, parsed.data)), auditArgs };
        } catch (error) {
          // The LLM gets a safe instruction instead of a transport error (CP1 H2).
          return { ...failures.temporaryError(), auditArgs, failure: describeFailure(error) };
        }
      },
    };
  };
}
