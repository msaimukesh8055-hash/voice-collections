// web/src/features/ops/OpsStatus.tsx
// The ops page's sections (redesign, Saim 2026-11-23): up or down now with uptime since the
// first health probe, outside services, background jobs, and errors grouped by kind; each
// target sits next to its own number (TargetLine), not in a separate table. Each figure has a one-line "how it's calculated" under it. Nothing before the first
// probe is shown as uptime: the page says "measured since" instead.
import type { ReactNode } from 'react';
import type {
  OpsErrorGroup,
  OpsJob,
  OpsService,
  OpsStatus,
  OpsTarget,
} from '../../lib/opsStatusSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';
import { type Tone, TONE_CLASSES } from './opsFormat.ts';

const CELL = 'px-2 py-1.5 align-top';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

/** The one-line "how it's calculated" under a figure. */
export function How({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <p className="mt-1 text-xs text-ink-muted">{children}</p>;
}

const NOW_WORDS: Readonly<Record<OpsStatus['now']['state'], { text: string; tone: Tone }>> = {
  up: { text: 'Up', tone: 'good' },
  down: { text: 'Down', tone: 'bad' },
  stale: { text: 'Not checked lately', tone: 'warn' },
  unknown: { text: 'Not measured yet', tone: 'plain' },
};

function UptimeFigure({
  label,
  uptime,
}: {
  readonly label: string;
  readonly uptime: OpsStatus['uptime']['day'];
}): React.JSX.Element {
  const tone: Tone = uptime === null ? 'plain' : uptime.percent >= 99.5 ? 'good' : 'bad';
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-xl font-semibold ${TONE_CLASSES[tone]}`}>
        {uptime === null ? '—' : `${uptime.percent}%`}
      </p>
      <p className="text-xs text-ink-muted">
        {uptime === null ? 'no probes' : `${uptime.ok} of ${uptime.expected} probes`}
      </p>
    </div>
  );
}

export function StatusCard({ status }: { readonly status: OpsStatus }): React.JSX.Element {
  const { now, uptime, measuredSince } = status;
  const words = NOW_WORDS[now.state];
  return (
    <Card title="Status">
      <p className={`text-2xl font-semibold ${TONE_CLASSES[words.tone]}`}>{words.text}</p>
      <p className="text-sm text-ink-muted">
        {now.checkedAt
          ? `Last check ${dateTime(now.checkedAt)}, ${now.durationMs ?? 0} ms · version ${now.version ?? 'unknown'}`
          : 'The first health probe has not run yet.'}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <UptimeFigure label="24 hours" uptime={uptime.day} />
        <UptimeFigure label="7 days" uptime={uptime.week} />
        <UptimeFigure label="Since start" uptime={uptime.all} />
      </div>
      <How>
        {measuredSince
          ? `Measured since ${dateTime(measuredSince)}, the first health probe; nothing before it is known. `
          : 'Not measured yet. '}
        Every 5 minutes a timer calls the app API&apos;s health check, which reads the database.
        Uptime is probes that got a 200 out of every 5-minute slot; a probe that never ran counts as
        down.
      </How>
    </Card>
  );
}

function metWords(met: boolean | null): { text: string; tone: Tone } {
  if (met === null) return { text: 'No data yet', tone: 'plain' };
  return met ? { text: 'Met', tone: 'good' } : { text: 'Missed', tone: 'bad' };
}

/** A target next to its own number (2026-11-23): goal, where it is now, met or missed. */
export function TargetLine({
  target,
}: {
  readonly target: OpsTarget | undefined;
}): React.JSX.Element | null {
  if (!target) return null;
  const words = metWords(target.met);
  return (
    <div className="mt-3 rounded-xl bg-canvas px-3 py-2 text-sm ring-1 ring-border">
      <p>
        <span className="font-medium">Target: {target.goal}</span>
        <span className="text-ink-muted"> · now {target.now} · </span>
        <span className={`font-medium ${TONE_CLASSES[words.tone]}`}>{words.text}</span>
      </p>
      <How>{target.how}</How>
    </div>
  );
}

const SERVICE_WORDS: Readonly<Record<OpsService['state'], { text: string; tone: Tone }>> = {
  ok: { text: 'Working', tone: 'good' },
  recovered: { text: 'Working (failed earlier)', tone: 'warn' },
  failing: { text: 'Failing', tone: 'bad' },
  idle: { text: 'Not used in 7 days', tone: 'plain' },
  unknown: { text: 'Not checked yet', tone: 'plain' },
};

/** Sarvam LLM's row also says how many answers our code threw away (badly shaped). */
export interface Rejected {
  readonly answers: number;
  readonly rejected: number;
}

function ServiceRow({
  service,
  rejected,
}: {
  readonly service: OpsService;
  readonly rejected: Rejected | null;
}): React.JSX.Element {
  const words = SERVICE_WORDS[service.state];
  return (
    <tr className="border-t border-border">
      <td className={CELL}>
        <span className="font-medium">{service.name}</span>
        <span className="block text-xs text-ink-muted">{service.use}</span>
        {rejected ? (
          <span className={`block text-xs ${rejected.rejected > 0 ? TONE_CLASSES.warn : ''}`}>
            {rejected.rejected} of {rejected.answers} answers rejected as badly shaped
          </span>
        ) : null}
        <How>{service.how}</How>
      </td>
      <td className={CELL}>{service.calls}</td>
      <td className={`${CELL} ${service.failed > 0 ? TONE_CLASSES.bad : ''}`}>
        {service.failed}
        {service.lastFailedAt ? (
          <span className="block text-xs text-ink-muted">
            last {dateTime(service.lastFailedAt)}
          </span>
        ) : null}
      </td>
      <td className={`${CELL} font-medium ${TONE_CLASSES[words.tone]}`}>{words.text}</td>
    </tr>
  );
}

export function ServicesCard({
  services,
  sarvamRejected = null,
}: {
  readonly services: readonly OpsService[];
  readonly sarvamRejected?: Rejected | null;
}): React.JSX.Element {
  return (
    <Card title="Outside services · 7 days">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Service</th>
              <th className={HEAD}>Calls</th>
              <th className={HEAD}>Failed</th>
              <th className={HEAD}>State</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <ServiceRow
                key={service.name}
                service={service}
                rejected={service.name.startsWith('Sarvam LLM') ? sarvamRejected : null}
              />
            ))}
          </tbody>
        </table>
      </div>
      <How>
        As our own calls saw each service; we do not read their status pages. Eval traffic left out.
      </How>
    </Card>
  );
}

const JOB_WORDS: Readonly<Record<OpsJob['state'], { text: string; tone: Tone }>> = {
  ok: { text: 'On time', tone: 'good' },
  late: { text: 'Runs missing', tone: 'bad' },
  failing: { text: 'Failing', tone: 'bad' },
  off: { text: 'Switched off', tone: 'warn' },
  not_run: { text: 'Not run yet', tone: 'plain' },
};

function JobRow({ job }: { readonly job: OpsJob }): React.JSX.Element {
  const words = JOB_WORDS[job.state];
  return (
    <tr className="border-t border-border">
      <td className={CELL}>
        <span className="font-mono text-xs">{job.name}</span>
        <span className="block text-xs text-ink-muted">{job.what}</span>
      </td>
      <td className={CELL}>{job.when}</td>
      <td className={CELL}>{job.lastRunAt ? dateTime(job.lastRunAt) : '—'}</td>
      <td className={CELL}>
        {job.dayRuns}
        <How>{job.note}</How>
      </td>
      <td className={`${CELL} font-medium ${TONE_CLASSES[words.tone]}`}>{words.text}</td>
    </tr>
  );
}

export function JobsCard({ jobs }: { readonly jobs: readonly OpsJob[] }): React.JSX.Element {
  return (
    <Card title="Background jobs">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Job</th>
              <th className={HEAD}>When</th>
              <th className={HEAD}>Last run</th>
              <th className={HEAD}>Runs · 24 h</th>
              <th className={HEAD}>State</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <JobRow key={job.name} job={job} />
            ))}
          </tbody>
        </table>
      </div>
      <How>
        From pg_cron&apos;s own run record, and for timers the requests that reached the follow-up
        worker. On time: no failed run, and 95% of runs reached the worker.
      </How>
    </Card>
  );
}

function ErrorGroupRow({ group }: { readonly group: OpsErrorGroup }): React.JSX.Element {
  return (
    <li className="py-2">
      <a
        href={`/ops?id=${group.traceId}`}
        className="font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {group.source} · {group.step}
      </a>
      <p className="text-ink-muted">
        {group.errorCode ?? 'no code'} · {group.count}× · last {dateTime(group.lastAt)}
      </p>
    </li>
  );
}

export function ErrorGroupsCard({
  groups,
}: {
  readonly groups: readonly OpsErrorGroup[];
}): React.JSX.Element {
  return (
    <Card title="Errors">
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted">No errors in the last 7 days.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {groups.map((group) => (
            <ErrorGroupRow
              key={`${group.source}|${group.step}|${group.errorCode ?? ''}`}
              group={group}
            />
          ))}
        </ul>
      )}
      <How>
        Every error step in 7 days, grouped by function, step and error code, newest first; the link
        opens the latest one&apos;s trace as a readable timeline. Eval traffic left out.
      </How>
    </Card>
  );
}
