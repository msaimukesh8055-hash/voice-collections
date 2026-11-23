// supabase/functions/_shared/llm/observer.ts
// Step 6 (ADR-0023): the Langfuse observer as each Edge Function wires it: the real fetch, our
// current trace id (so a Langfuse trace and an ops trace share one id) and the function's own
// `defer`, so a send finishes after the reply without holding it up. Undefined (off) unless
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are both set.
import type { Logger } from '../log.ts';
import { currentTrace } from '../ops/trace.ts';
import { createLangfuseObserver, type LangfuseEnv, type LlmObserver } from './langfuse.ts';

export function createLlmObserver(
  env: LangfuseEnv,
  deps: { readonly defer: (task: Promise<unknown>) => void; readonly log: Logger },
): LlmObserver | undefined {
  return createLangfuseObserver(env, {
    fetchImpl: fetch,
    defer: deps.defer,
    log: deps.log,
    traceId: () => currentTrace()?.id ?? null,
    newId: () => crypto.randomUUID(),
  });
}
