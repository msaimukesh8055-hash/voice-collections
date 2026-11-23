// supabase/functions/calls-api/trace-links.ts
// Readable traces (Saim, 2026-11-23): every trace view (Asha and Munshi call pages, a WhatsApp
// message's report, the Ops trace) links each AI step to that trace in Langfuse, where the prompt
// and the answer are. Our own steps never hold that text (security rule); Langfuse does when
// tracing is on. An AI step is one with a provider (Sarvam or Gemini) other than the token count.
import type { TraceStep } from '../_shared/db/ops-repository.ts';
import type { RouteContext } from './types.ts';

export type LinkedStep = TraceStep & { readonly langfuseUrl?: string };

const TOKEN_STEP = 'llm_usage';

export function isAiStep(step: TraceStep): boolean {
  return step.provider !== null && step.step !== TOKEN_STEP;
}

/** The steps, each AI step with its Langfuse link when tracing is on; unchanged otherwise. */
export function linkSteps(steps: readonly TraceStep[], ctx: RouteContext): readonly LinkedStep[] {
  const link = ctx.deps.dashboard.langfuseTraceUrl;
  if (!link) return steps;
  return steps.map((step) => {
    if (!isAiStep(step) || !step.traceId) return step;
    const url = link(step.traceId);
    return url ? { ...step, langfuseUrl: url } : step;
  });
}
