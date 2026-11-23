// web/src/features/ops/OpsPage.tsx
// /ops: is the shared machine working? (Saim, 2026-11-23: nothing about agents or tools here;
// those are on Agent health.) A top line ("✓ All working" or what needs attention), then folding
// sections with a menu: Now (up or down, uptime, reminder calls running or paused), Errors (by
// kind, each opening its trace as a readable timeline), Outside services (Sarvam LLM with its
// rejected answers, Gemini, voice, Meta, the database), Background jobs (with the follow-up
// queue), Money (spend against the ₹1,000 cap) and Details (time per function). Each target sits
// next to its own number. /ops?id=<trace id> opens one trace. Read-only.
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { OpsSummary } from '../../lib/opsSchemas.ts';
import type { OpsStatus } from '../../lib/opsStatusSchemas.ts';
import { dateTime, formatInr } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { type PageSection, Sections } from '../dashboard/Sections.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import {
  ErrorGroupsCard,
  How,
  JobsCard,
  ServicesCard,
  StatusCard,
  TargetLine,
} from './OpsStatus.tsx';
import { TraceView } from './TraceView.tsx';
import { TONE_CLASSES } from './opsFormat.ts';

const CELL = 'px-2 py-1.5';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

function target(status: OpsStatus | null, id: string): OpsStatus['targets'][number] | undefined {
  return status?.targets.find((one) => one.id === id);
}

/** What needs attention, in a few words each; empty when all is working. */
export function opsIssues(ops: OpsSummary): string[] {
  const { status } = ops;
  if (!status) return [];
  const issues: string[] = [];
  if (status.now.state === 'down') issues.push('App API down');
  if (status.now.state === 'stale') issues.push('Health checks stopped');
  for (const one of status.targets) if (one.met === false) issues.push(one.name);
  for (const service of status.services) {
    if (service.state === 'failing') issues.push(`${service.name} failing`);
  }
  return issues;
}

function TopLine({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const issues = opsIssues(ops);
  const words =
    issues.length === 1 ? '1 thing needs attention' : `${issues.length} things need attention`;
  return (
    <p
      className={`rounded-2xl bg-surface/95 px-5 py-3 text-lg font-semibold shadow-sm ring-1 ring-border ${
        TONE_CLASSES[issues.length === 0 ? 'good' : 'warn']
      }`}
    >
      {issues.length === 0 ? '✓ All working' : `⚠ ${words}: ${issues.join(' · ')}`}
    </p>
  );
}

function CallsSwitch({ paused }: { readonly paused: boolean }): React.JSX.Element {
  return (
    <Card title="Reminder calls">
      <p className={`text-xl font-semibold ${TONE_CLASSES[paused ? 'warn' : 'good']}`}>
        {paused ? 'Paused' : 'Running'}
      </p>
      <p className="text-sm text-ink-muted">
        {paused
          ? 'No new call starts until /resume is sent on WhatsApp.'
          : 'Send /pause on WhatsApp to stop all new calls.'}
      </p>
      <How>The /pause switch, read from the demo settings.</How>
    </Card>
  );
}

function NowSection({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <>
      {ops.status ? (
        <>
          <StatusCard status={ops.status} />
          <TargetLine target={target(ops.status, 'uptime')} />
        </>
      ) : null}
      <CallsSwitch paused={ops.callsPaused} />
    </>
  );
}

/** Errors from a server before the redesign: the latest error rows. */
function LatestErrors({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <Card title="Errors">
      {ops.recentErrors.length === 0 ? (
        <p className="text-sm text-ink-muted">No errors in the last 7 days.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {ops.recentErrors.map((error) => (
            <li key={`${error.traceId}:${error.step}:${error.createdAt}`} className="py-2">
              <a href={`/ops?id=${error.traceId}`} className="font-medium text-brand underline">
                {dateTime(error.createdAt)} · {error.step}
              </a>
              <p className="text-ink-muted">
                {error.source}
                {error.errorCode ? ` · ${error.errorCode}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ErrorsSection({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  if (!ops.status) return <LatestErrors ops={ops} />;
  return (
    <>
      <TargetLine target={target(ops.status, 'requests')} />
      <ErrorGroupsCard groups={ops.status.errorGroups} />
    </>
  );
}

function sarvamRejected(ops: OpsSummary): { answers: number; rejected: number } | null {
  const row = ops.llm.find((one) => one.provider === 'sarvam');
  return row ? { answers: row.answers, rejected: row.rejected } : null;
}

function FollowUpQueue({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const { waiting, stuck, failedWeek } = ops.followups;
  return (
    <Card title="Follow-up queue">
      <p className={`text-xl font-semibold ${TONE_CLASSES[stuck > 0 ? 'bad' : 'good']}`}>
        {stuck > 0 ? `${stuck} stuck` : 'Clear'}
      </p>
      <p className="text-sm text-ink-muted">
        {waiting} waiting now · {failedWeek} failed in 7 days
      </p>
      <TargetLine target={target(ops.status, 'queue')} />
    </Card>
  );
}

function JobsSection({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <>
      {ops.status ? (
        <>
          <TargetLine target={target(ops.status, 'jobs')} />
          <JobsCard jobs={ops.status.jobs} />
        </>
      ) : null}
      <FollowUpQueue ops={ops} />
    </>
  );
}

function Money({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const { capInr, today, month } = ops.spend;
  const used = Math.min(100, Math.round((month.totalInr / capInr) * 100));
  return (
    <Card title="Money">
      <p className="text-xl font-semibold">
        {formatInr(month.totalInr)} of {formatInr(capInr)} this month
      </p>
      <div
        role="progressbar"
        aria-label="Share of the spend cap used"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={100}
        className="my-2 h-2 overflow-hidden rounded-full bg-brand-soft"
      >
        <div className="h-full bg-brand" style={{ width: `${used}%` }} />
      </div>
      <p className="text-sm text-ink-muted">
        Voice {formatInr(month.voiceInr)} · LLM {formatInr(month.llmInr)} · today{' '}
        {formatInr(today.totalInr)}
      </p>
      <How>
        Live voice minutes (each call rounded up) × ₹3.50 + GST, plus LLM tokens × the price list,
        eval runs included.
      </How>
      <TargetLine target={target(ops.status, 'spend')} />
    </Card>
  );
}

function FunctionTimes({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <Card title="Details">
      <h3 className="mb-2 text-sm font-semibold">Time per function · 24 hours</h3>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={HEAD}>Function</th>
            <th className={HEAD}>Requests</th>
            <th className={HEAD}>Failed</th>
            <th className={HEAD}>95% within</th>
          </tr>
        </thead>
        <tbody>
          {ops.sources.map((source) => (
            <tr key={source.source} className="border-t border-border">
              <td className={`${CELL} font-mono text-xs`}>{source.source}</td>
              <td className={CELL}>{source.requests}</td>
              <td className={`${CELL} ${source.failed > 0 ? TONE_CLASSES.bad : ''}`}>
                {source.failed}
              </td>
              <td className={CELL}>{source.p95Ms === null ? '–' : `${source.p95Ms} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function opsSections(ops: OpsSummary): PageSection[] {
  const bad = (id: string): string | null => (target(ops.status, id)?.met === false ? '⚠' : null);
  const failing = ops.status?.services.some((one) => one.state === 'failing') ?? false;
  const downNow = ops.status?.now.state === 'down' || ops.status?.now.state === 'stale';
  return [
    {
      id: 'now',
      title: 'Now',
      badge: downNow ? '⚠' : bad('uptime'),
      content: <NowSection ops={ops} />,
    },
    { id: 'errors', title: 'Errors', badge: bad('requests'), content: <ErrorsSection ops={ops} /> },
    {
      id: 'services',
      title: 'Outside services · 7 days',
      badge: failing ? '⚠' : null,
      content: ops.status ? (
        <ServicesCard services={ops.status.services} sarvamRejected={sarvamRejected(ops)} />
      ) : null,
    },
    {
      id: 'jobs',
      title: 'Background jobs',
      badge: bad('jobs') ?? bad('queue'),
      content: <JobsSection ops={ops} />,
    },
    { id: 'money', title: 'Money', badge: bad('spend'), content: <Money ops={ops} /> },
    { id: 'details', title: 'Details', content: <FunctionTimes ops={ops} /> },
  ];
}

function Summary({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <>
      <Sections top={<TopLine ops={ops} />} sections={opsSections(ops)} />
      <p className="text-xs text-ink-muted">
        As of {dateTime(ops.generatedAt)}. Counts, timings and error codes only: no names, phone
        numbers or amounts are recorded. Pilot targets we set ourselves, not a contract. How the
        agents are doing is on{' '}
        <a href="/health" className="font-medium text-brand underline">
          Agent health
        </a>
        .
      </p>
    </>
  );
}

function All({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.ops, 'ops');
  return <LoadState state={state}>{(ops: OpsSummary) => <Summary ops={ops} />}</LoadState>;
}

export function OpsPage({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
}): React.JSX.Element {
  return (
    <Layout current="/ops" dashboard={dashboard}>
      {id ? <TraceView dashboard={dashboard} id={id} /> : <All dashboard={dashboard} />}
    </Layout>
  );
}
