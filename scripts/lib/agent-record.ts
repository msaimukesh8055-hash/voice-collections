// scripts/lib/agent-record.ts
// Builds the `publishes` row for a committed Sarvam version of an agent (M3 plan: one committed
// version = one row). The eval run stays empty until the M7 release gate.
import { z } from 'zod';

export const SarvamRecordSchema = z.object({
  appId: z.string('appId is empty: create the agent in Sarvam first').trim().min(1),
  committedVersion: z
    .number('committedVersion is empty: commit a version in Sarvam first')
    .int()
    .positive('committedVersion must be a committed Sarvam version'),
});

export interface PublishRow {
  readonly agent: string;
  readonly prompt_hash: string;
  readonly sarvam_app_id: string;
  readonly sarvam_version: number;
}

export function buildPublishRow(agent: string, record: unknown, configHash: string): PublishRow {
  const parsed = SarvamRecordSchema.safeParse(record);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`sarvam-agent.json: ${reasons}`);
  }
  return {
    agent,
    prompt_hash: configHash,
    sarvam_app_id: parsed.data.appId,
    sarvam_version: parsed.data.committedVersion,
  };
}
