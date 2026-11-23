// web/src/lib/opsStatusSchemas.ts
// The ops page's status section (redesign, Saim 2026-11-23): up or down from the health probes,
// uptime since the first probe, service targets, outside services, scheduled jobs and errors
// grouped by kind. Built on the server (ops/status.ts); checked here like every reply. A reply
// without it (an older server) shows the page without these sections, never a crash.
import { z } from 'zod';

const UptimeSchema = z.object({ percent: z.number(), ok: z.number(), expected: z.number() });

const TargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  now: z.string(),
  met: z.boolean().nullable(),
  how: z.string(),
});

const ServiceSchema = z.object({
  name: z.string(),
  use: z.string(),
  calls: z.number(),
  failed: z.number(),
  lastFailedAt: z.string().nullable(),
  state: z.enum(['ok', 'recovered', 'failing', 'idle', 'unknown']),
  how: z.string(),
});

const JobSchema = z.object({
  name: z.string(),
  what: z.string(),
  when: z.string(),
  lastRunAt: z.string().nullable(),
  dayRuns: z.number(),
  dayReached: z.number().nullable(),
  state: z.enum(['ok', 'late', 'failing', 'off', 'not_run']),
  note: z.string(),
});

const ErrorGroupSchema = z.object({
  source: z.string(),
  step: z.string(),
  errorCode: z.string().nullable(),
  count: z.number(),
  lastAt: z.string(),
  traceId: z.string(),
});

export const OpsStatusSchema = z.object({
  measuredSince: z.string().nullable(),
  now: z.object({
    state: z.enum(['up', 'down', 'stale', 'unknown']),
    checkedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    version: z.string().nullable(),
  }),
  uptime: z.object({
    day: UptimeSchema.nullable(),
    week: UptimeSchema.nullable(),
    all: UptimeSchema.nullable(),
  }),
  targets: z.array(TargetSchema),
  services: z.array(ServiceSchema),
  jobs: z.array(JobSchema),
  errorGroups: z.array(ErrorGroupSchema),
});

export type OpsStatus = z.infer<typeof OpsStatusSchema>;
export type OpsTarget = OpsStatus['targets'][number];
export type OpsService = OpsStatus['services'][number];
export type OpsJob = OpsStatus['jobs'][number];
export type OpsErrorGroup = OpsStatus['errorGroups'][number];
