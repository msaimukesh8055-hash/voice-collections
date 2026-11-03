// supabase/functions/_shared/tools/audit.ts
// One audit row per tool call (security.md: audit trail), for live calls (sarvam-tools) and
// simulated calls alike. A failed audit write is logged but never changes what the shopkeeper is
// told: the tool already ran (e.g. a promise was saved), so failing now would invite a duplicate
// (CP1 H2).
import type { Repository } from '../db/repository.ts';
import type { Logger } from '../log.ts';
import { describeFailure, type ToolRun } from './registry.ts';

export interface AuditEvent {
  readonly callId: string;
  readonly tool: string;
  readonly run: ToolRun;
  readonly durationMs: number;
}

export async function auditToolRun(
  event: AuditEvent,
  deps: { readonly repo: Pick<Repository, 'insertToolEvent'>; readonly log: Logger },
): Promise<void> {
  const { callId, tool, run, durationMs } = event;
  try {
    await deps.repo.insertToolEvent({
      callId,
      tool,
      args: run.auditArgs,
      result: run.result,
      durationMs,
    });
  } catch (error) {
    deps.log('error', 'audit_write_failed', { callId, tool, error: describeFailure(error) });
  }
}
