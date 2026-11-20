// web/src/features/health/HealthPage.tsx
// /health (Saim, 2026-11-20): Agent health, apart from Ops and linked both ways. Ops answers "is
// the system working?"; this page answers "are the agents doing a good job?" across Asha's and
// Munshi's recent calls: verdicts, the checks that go wrong most (each opening the calls behind
// it), guardrail fails, reply time, cost, tone, the same numbers per prompt version, and a 14-day
// trend. Worked out from each call's kept scorecard.
import { checkHelp } from '../calls/checkHelp.ts';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { AgentHealth, HealthSummary } from '../../lib/healthSchemas.ts';
import { formatInr, shortDate } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { type Tone, TONE_CLASSES } from '../ops/opsFormat.ts';

export const HEALTH_PATH = '/health';
/** Same aims as the call scorecard. */
const COST_AIM_INR = 15;
const REPLY_AIM_MS = 1_500;
const GOOD_TONE = 4;
const CALL_LINKS = 3;
const CELL = 'px-2 py-1.5';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

const NAMES: Readonly<Record<AgentHealth['agent'], string>> = {
  asha: 'Asha · calls shopkeepers',
  munshi: 'Munshi · the owner’s clerk',
};

function callHref(agent: AgentHealth['agent'], id: string): string {
  const page = agent === 'asha' ? '/calls' : '/munshi-calls';
  return `${page}?id=${encodeURIComponent(id)}`;
}

function share(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function Figure({
  label,
  value,
  tone = 'plain',
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
  readonly note?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-canvas p-3 ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${TONE_CLASSES[tone]}`}>{value}</p>
      {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

function Figures({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  const { verdicts, calls, replyP50Ms, averageCostInr, guardrailFails } = health;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure
        label="Went well"
        value={share(verdicts.good, calls)}
        tone={verdicts.failed > 0 ? 'warn' : 'good'}
        note={`✅ ${verdicts.good} · ⚠ ${verdicts.check} · ❌ ${verdicts.failed} of ${calls}`}
      />
      <Figure
        label="Guardrail fails"
        value={String(guardrailFails)}
        tone={guardrailFails > 0 ? 'bad' : 'good'}
        note="calls with at least one"
      />
      <Figure
        label="Reply time, typical"
        value={replyP50Ms === null ? 'n/a' : `${(replyP50Ms / 1000).toFixed(1)} s`}
        tone={replyP50Ms === null ? 'plain' : replyP50Ms <= REPLY_AIM_MS ? 'good' : 'warn'}
        note={`aim ≤ ${REPLY_AIM_MS / 1000} s`}
      />
      <Figure
        label="Cost per call"
        value={averageCostInr === null ? 'n/a' : formatInr(averageCostInr)}
        tone={averageCostInr === null ? 'plain' : averageCostInr <= COST_AIM_INR ? 'good' : 'warn'}
        note={`aim ≤ ${formatInr(COST_AIM_INR)}`}
      />
    </div>
  );
}

function ProblemExplained({ id }: { readonly id: string }): React.JSX.Element | null {
  const help = checkHelp(id);
  if (!help) return null;
  return (
    <span className="mt-1 block text-xs">
      {help.means} <span className="text-ink-muted">If it misses: {help.miss}</span>
    </span>
  );
}

function Problems({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  if (health.problems.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing failed or needed a look.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={HEAD}>What went wrong</th>
          <th className={HEAD}>Fails</th>
          <th className={HEAD}>Warnings</th>
          <th className={HEAD}>Calls</th>
        </tr>
      </thead>
      <tbody>
        {health.problems.map((problem) => (
          <tr key={problem.id} className="border-t border-border">
            <td className={CELL}>
              {problem.label}
              <span className="block text-xs text-ink-muted">{problem.group}</span>
              <ProblemExplained id={problem.id} />
            </td>
            <td className={`${CELL} ${problem.fails > 0 ? 'text-danger' : ''}`}>{problem.fails}</td>
            <td className={`${CELL} ${problem.warns > 0 ? 'text-warning' : ''}`}>
              {problem.warns}
            </td>
            <td className={CELL}>
              {problem.callIds.slice(0, CALL_LINKS).map((id, index) => (
                <a
                  key={id}
                  href={callHref(health.agent, id)}
                  className="mr-2 font-medium text-brand underline"
                >
                  #{index + 1}
                </a>
              ))}
              {problem.callIds.length > CALL_LINKS ? (
                <span className="text-xs text-ink-muted">
                  +{problem.callIds.length - CALL_LINKS}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ToneList({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  if (health.tone.length === 0) return <p className="text-sm text-ink-muted">Not judged yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {health.tone.map((point) => (
        <li key={point.id} className="flex justify-between gap-3">
          <span>{point.label}</span>
          <span
            className={`font-medium ${point.average >= GOOD_TONE ? 'text-success' : 'text-warning'}`}
          >
            {point.average.toFixed(1)}/5
            <span className="ml-1 text-xs font-normal text-ink-muted">({point.calls})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Versions({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={HEAD}>Version</th>
          <th className={HEAD}>Calls</th>
          <th className={HEAD}>Went well</th>
          <th className={HEAD}>⚠ / ❌</th>
        </tr>
      </thead>
      <tbody>
        {health.versions.map((row) => (
          <tr key={String(row.version)} className="border-t border-border">
            <td className={CELL}>{row.version === null ? 'unknown' : `v${row.version}`}</td>
            <td className={CELL}>{row.calls}</td>
            <td className={CELL}>{share(row.good, row.calls)}</td>
            <td className={CELL}>
              {row.check} / {row.failed}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Trend({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  const most = Math.max(1, ...health.trend.map((day) => day.good + day.check + day.failed));
  return (
    <div>
      <div className="flex h-24 items-end gap-1" aria-label="Calls per day, last 14 days">
        {health.trend.map((day) => {
          const total = day.good + day.check + day.failed;
          return (
            <div
              key={day.date}
              title={`${shortDate(day.date)}: ✅ ${day.good} · ⚠ ${day.check} · ❌ ${day.failed}`}
              className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm bg-canvas"
              style={{ height: `${Math.max(4, (total / most) * 100)}%` }}
            >
              <span className="bg-success" style={{ flexGrow: day.good }} />
              <span className="bg-warning" style={{ flexGrow: day.check }} />
              <span className="bg-danger" style={{ flexGrow: day.failed }} />
            </div>
          );
        })}
      </div>
      <p className="mt-1 flex justify-between text-xs text-ink-muted">
        <span>{shortDate(health.trend[0]?.date ?? '')}</span>
        <span>today</span>
      </p>
    </div>
  );
}

function AgentCard({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  return (
    <Card title={`${NAMES[health.agent]} · last ${health.calls} calls`}>
      {health.calls === 0 ? (
        <p className="text-sm text-ink-muted">No finished calls yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Figures health={health} />
          <section>
            <h3 className="mb-2 text-sm font-semibold">What goes wrong most</h3>
            <Problems health={health} />
          </section>
          <div className="grid gap-5 md:grid-cols-3">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Tone (AI judge)</h3>
              <ToneList health={health} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">By prompt version</h3>
              <Versions health={health} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Last 14 days</h3>
              <Trend health={health} />
            </section>
          </div>
        </div>
      )}
    </Card>
  );
}

function Summary({ summary }: { readonly summary: HealthSummary }): React.JSX.Element {
  return (
    <>
      <p className="text-sm text-ink-muted">
        Is each agent doing a good job? Worked out from every finished call&apos;s scorecard. For
        system errors and speed, see{' '}
        <a href="/ops" className="font-medium text-brand underline">
          Ops
        </a>
        .
      </p>
      {summary.agents.map((health) => (
        <AgentCard key={health.agent} health={health} />
      ))}
      {summary.waiting > 0 ? (
        <p className="text-xs text-ink-muted">
          {summary.waiting} older call(s) not scored yet; they are added a few at a time each time
          this page opens.
        </p>
      ) : null}
    </>
  );
}

export function HealthPage({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.agentHealth, 'agent-health');
  return (
    <Layout current={HEALTH_PATH} dashboard={dashboard}>
      <h1 className="text-2xl font-semibold">Agent health</h1>
      <LoadState state={state}>
        {(summary: HealthSummary) => <Summary summary={summary} />}
      </LoadState>
    </Layout>
  );
}

/** Ops page tile: each agent's share of calls that went well, opening this page. */
export function AgentQualityLink({
  dashboard,
}: {
  readonly dashboard: DashboardApi;
}): React.JSX.Element {
  const state = useLoad(dashboard.agentHealth, 'agent-health');
  return (
    <a
      href={HEALTH_PATH}
      className="block rounded-2xl bg-surface/95 p-4 shadow-sm ring-1 ring-border hover:ring-brand"
    >
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">Agent quality</h2>
      <p className="mt-1 text-sm">
        {state.kind === 'ready'
          ? state.data.agents
              .map(
                (health) =>
                  `${health.agent === 'asha' ? 'Asha' : 'Munshi'} ${health.verdicts.good}/${health.calls} went well`,
              )
              .join(' · ')
          : 'Each agent’s calls, scored'}
      </p>
      <p className="mt-1 text-sm font-medium text-brand underline">Open Agent health →</p>
    </a>
  );
}
