// supabase/functions/_shared/owner-tools/audit.ts
// One owner_tool_events row per Munshi tool call, refusals included (security.md: audit trail).
// Arguments are stored only after they passed validation (otherwise a marker), never raw LLM
// output. A failed audit write is logged but never changes what Munshi is told.
import type { OwnerCallRepository } from '../db/owner-call-repository.ts';
import type { Logger } from '../log.ts';
import { describeFailure } from '../tools/define.ts';
import type { OwnerToolRun } from './registry.ts';

export interface OwnerAuditEvent {
  readonly ownerCallId: string;
  readonly tool: string;
  readonly run: OwnerToolRun;
  readonly durationMs: number;
}

export async function auditOwnerToolRun(
  event: OwnerAuditEvent,
  deps: {
    readonly ownerCalls: Pick<OwnerCallRepository, 'insertOwnerToolEvent'>;
    readonly log: Logger;
  },
): Promise<void> {
  const { ownerCallId, tool, run, durationMs } = event;
  try {
    await deps.ownerCalls.insertOwnerToolEvent({
      ownerCallId,
      tool,
      args: run.auditArgs,
      result: run.result,
      durationMs,
    });
  } catch (error) {
    deps.log('error', 'owner_audit_write_failed', {
      ownerCallId,
      tool,
      error: describeFailure(error),
    });
  }
}
