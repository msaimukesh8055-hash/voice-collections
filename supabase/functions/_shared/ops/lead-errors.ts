// supabase/functions/_shared/ops/lead-errors.ts
// One failed request often leaves two error steps on its trace: the step that broke, then the
// request itself marked HTTP 500. People count failures, not steps, so the ops page and the
// alert both show one line per failed request, named by the step that says what went wrong.
import type { OpsError } from '../db/ops-repository.ts';
import { REQUEST_STEP } from './tracing.ts';

function leadOf(errors: readonly OpsError[]): OpsError | undefined {
  return errors.find((error) => error.step !== REQUEST_STEP) ?? errors[0];
}

/** One error per trace, in the order the traces first appear. */
export function leadErrors(errors: readonly OpsError[]): readonly OpsError[] {
  const byTrace = Map.groupBy(errors, (error) => error.traceId);
  return [...byTrace.values()].map(leadOf).filter((error) => error !== undefined);
}
