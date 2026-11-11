// web/src/features/ops/OpsPage.tsx
// /ops (M9 Build A): is the product healthy right now? Error rate, tool latency against the
// 500 ms target, how often an LLM answer was rejected, the follow-up queue, spend against the
// cap, and the latest errors, each opening its trace (/ops?id=<trace id>). Read-only.
import type { ReactNode } from 'react';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { OpsSummary } from '../../lib/opsSchemas.ts';
import { dateTime, formatInr } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { TraceView } from './TraceView.tsx';
import { percent, statusOfRate, type Tone, TONE_CLASSES } from './opsFormat.ts';

/** WhatsApp messages answered in code, with no model involved. */
const CODE_PATHS = ['button', 'command'];
const CELL = 'px-2 py-1.5';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

function Tile({
  label,
  value,
  tone = 'plain',
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-surface/95 p-4 shadow-sm ring-1 ring-border">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</h2>
      <p className={`mt-1 text-2xl font-semibold ${TONE_CLASSES[tone]}`}>{value}</p>
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
    </section>
  );
}

function RequestsTile({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const { day, week } = ops;
  return (
    <Tile
      label="Error rate · 24 h"
      value={percent(day.failed, day.requests)}
      tone={statusOfRate(day.failed, day.requests)}
    >
      <p>
        {day.failed} of {day.requests} requests failed
      </p>
      <p>
        7 days: {percent(week.failed, week.requests)} ({week.failed} of {week.requests})
      </p>
    </Tile>
  );
}

function RejectedTile({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const answers = ops.llm.reduce((sum, row) => sum + row.answers, 0);
  const rejected = ops.llm.reduce((sum, row) => sum + row.rejected, 0);
  return (
    <Tile
      label="Rejected LLM answers · 7 d"
      value={percent(rejected, answers)}
      tone={statusOfRate(rejected, answers)}
    >
      {ops.llm.length === 0 ? <p>No LLM calls recorded yet</p> : null}
      {ops.llm.map((row) => (
        <p key={row.provider}>
          {row.provider}: {row.rejected} rejected, {row.failed} failed of {row.answers}
        </p>
      ))}
    </Tile>
  );
}

function PathsTile({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const total = Object.values(ops.paths).reduce((sum, count) => sum + count, 0);
  const inCode = CODE_PATHS.reduce((sum, path) => sum + (ops.paths[path] ?? 0), 0);
  const fallback = ops.paths['gemini'] ?? 0;
  const failed = ops.paths['failed'] ?? 0;
  return (
    <Tile label="WhatsApp answered in code · 7 d" value={percent(inCode, total)}>
      <p>
        {ops.paths['sarvam'] ?? 0} by Sarvam, {fallback} by the Gemini fallback
      </p>
      <p className={failed > 0 ? TONE_CLASSES.bad : undefined}>{failed} not understood</p>
    </Tile>
  );
}

function QueueTile({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const { waiting, stuck, failedWeek } = ops.followups;
  return (
    <Tile
      label="Follow-up queue"
      value={stuck > 0 ? `${stuck} stuck` : 'Clear'}
      tone={stuck > 0 ? 'bad' : 'good'}
    >
      <p>{waiting} waiting now</p>
      <p>{failedWeek} failed in 7 days</p>
    </Tile>
  );
}

function SpendTile({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  const { capInr, today, month } = ops.spend;
  const used = Math.min(100, Math.round((month.totalInr / capInr) * 100));
  return (
    <Tile label="Spend this month" value={`${formatInr(month.totalInr)} of ${formatInr(capInr)}`}>
      <div
        role="progressbar"
        aria-label="Share of the spend cap used"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={100}
        className="my-1 h-2 overflow-hidden rounded-full bg-brand-soft"
      >
        <div className="h-full bg-brand" style={{ width: `${used}%` }} />
      </div>
      <p>
        Voice {formatInr(month.voiceInr)} · LLM {formatInr(month.llmInr)}
      </p>
      <p>
        Today: {formatInr(today.totalInr)} (voice {formatInr(today.voiceInr)}, LLM{' '}
        {formatInr(today.llmInr)})
      </p>
    </Tile>
  );
}

function ToolsCard({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <Card title={`Tool latency · 7 days · target p95 under ${ops.toolTargetMs} ms`}>
      {ops.tools.length === 0 ? (
        <p className="text-sm text-ink-muted">No tool calls in the last 7 days.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Agent</th>
              <th className={HEAD}>Tool</th>
              <th className={HEAD}>Calls</th>
              <th className={HEAD}>p50</th>
              <th className={HEAD}>p95</th>
              <th className={HEAD}>Target</th>
            </tr>
          </thead>
          <tbody>
            {ops.tools.map((tool) => {
              const within = tool.p95Ms < ops.toolTargetMs;
              return (
                <tr key={`${tool.agent}:${tool.tool}`} className="border-t border-border">
                  <td className={`${CELL} capitalize`}>{tool.agent}</td>
                  <td className={`${CELL} font-mono text-xs`}>{tool.tool}</td>
                  <td className={CELL}>{tool.calls}</td>
                  <td className={CELL}>{tool.p50Ms} ms</td>
                  <td className={CELL}>{tool.p95Ms} ms</td>
                  <td className={`${CELL} font-medium ${TONE_CLASSES[within ? 'good' : 'bad']}`}>
                    {within ? 'Within' : 'Over'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function SourcesCard({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <Card title="By function · 24 hours">
      {ops.sources.length === 0 ? (
        <p className="text-sm text-ink-muted">No requests in the last 24 hours.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Function</th>
              <th className={HEAD}>Requests</th>
              <th className={HEAD}>Failed</th>
              <th className={HEAD}>p95</th>
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
      )}
    </Card>
  );
}

function ErrorsCard({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <Card title="Latest errors">
      {ops.recentErrors.length === 0 ? (
        <p className="text-sm text-ink-muted">No errors in the last 7 days.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {ops.recentErrors.map((error) => (
            <li key={`${error.traceId}:${error.step}:${error.createdAt}`} className="py-2">
              <a
                href={`/ops?id=${error.traceId}`}
                className="font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              >
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

function Summary({ ops }: { readonly ops: OpsSummary }): React.JSX.Element {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RequestsTile ops={ops} />
        <RejectedTile ops={ops} />
        <PathsTile ops={ops} />
        <QueueTile ops={ops} />
        <SpendTile ops={ops} />
      </div>
      <ToolsCard ops={ops} />
      <SourcesCard ops={ops} />
      <ErrorsCard ops={ops} />
      <p className="text-xs text-ink-muted">
        As of {dateTime(ops.generatedAt)}. Counts, timings and error codes only: no names, phone
        numbers or amounts are recorded.
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
