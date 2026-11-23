// web/src/features/health/HealthPage.tsx
// /health (Saim, 2026-11-20): Agent health, apart from Ops and linked both ways. Ops answers "is
// the system working?"; this page answers "are the agents doing a good job?" across Asha's and
// Munshi's recent calls: verdicts, the checks that go wrong most (each opening the calls behind
// it), guardrail fails, reply time, cost, tone, the same numbers per prompt version, and a 14-day
// trend. Worked out from each call's kept scorecard. A summary of the Asha calls and Munshi calls
// pages (Saim, 2026-11-22): every count opens those pages filtered to the calls behind it, and
// "Why N calls need a look" counts only the calls that need a look or failed. WhatsApp bot
// (2026-11-22, ADR-0022): a third card, scored per owner message, opening /whatsapp.
// 2026-11-23: the 14-day trend is hidden until calls fall on at least 7 of those days.
// 2026-11-23 (Saim): a top line, each voice agent's tools against the 1 s target, WhatsApp's
// "95% within 5 s", and one folding section per agent with a menu (AgentTargets.tsx).
import { type CallFilter, filteredCallsHref } from '../calls/callFilter.tsx';
import { checkHelp } from '../calls/checkHelp.ts';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { AgentHealth, HealthSummary } from '../../lib/healthSchemas.ts';
import { formatInr, shortDate } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { type PageSection, Sections } from '../dashboard/Sections.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { type Tone, TONE_CLASSES } from '../ops/opsFormat.ts';
import { agentIssues, TopLine, ToolSpeeds, whatsappSlow } from './AgentTargets.tsx';

export const HEALTH_PATH = '/health';
const GOOD_TONE = 4;
const CELL = 'px-2 py-1.5';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

interface AgentInfo {
  readonly name: string;
  readonly short: string;
  /** The page that lists this agent's calls (or messages). */
  readonly page: string;
  readonly one: string;
  readonly many: string;
  /** Same aims as the agent's scorecard. */
  readonly costAimInr: number;
  readonly replyAimMs: number;
  /** Tone is judged and prompt versions are tracked for the voice agents only. */
  readonly voiceAgent: boolean;
}

const AGENTS: Readonly<Record<AgentHealth['agent'], AgentInfo>> = {
  asha: {
    name: 'Asha · calls shopkeepers',
    short: 'Asha',
    page: '/calls',
    one: 'call',
    many: 'calls',
    costAimInr: 15,
    replyAimMs: 1_500,
    voiceAgent: true,
  },
  munshi: {
    name: 'Munshi · the owner’s clerk',
    short: 'Munshi',
    page: '/munshi-calls',
    one: 'call',
    many: 'calls',
    costAimInr: 15,
    replyAimMs: 1_500,
    voiceAgent: true,
  },
  whatsapp: {
    name: 'WhatsApp bot · the owner’s chat',
    short: 'WhatsApp',
    page: '/whatsapp',
    one: 'message',
    many: 'messages',
    costAimInr: 2,
    replyAimMs: 3_000,
    voiceAgent: false,
  },
};

/** The agent's calls page showing just these calls. */
function callsHref(agent: AgentHealth['agent'], filter: CallFilter): string {
  return filteredCallsHref(AGENTS[agent].page, filter);
}

function callCount(count: number, agent: AgentHealth['agent']): string {
  const info = AGENTS[agent];
  return count === 1 ? `1 ${info.one}` : `${count} ${info.many}`;
}

const VERDICT_LINKS = [
  { key: 'good', text: 'went well', label: 'Went well', tone: 'good' },
  { key: 'check', text: 'need a look', label: 'Need a look', tone: 'warn' },
  { key: 'failed', text: 'failed', label: 'Failed', tone: 'bad' },
] as const;

/** "8 went well · 3 need a look · 0 failed of 11": each count opens those calls. */
function VerdictLinks({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
      {VERDICT_LINKS.map((verdict) => {
        const ids = health.verdictCallIds[verdict.key];
        const text = `${health.verdicts[verdict.key]} ${verdict.text}`;
        return ids.length > 0 ? (
          <a
            key={verdict.key}
            href={callsHref(health.agent, { ids, label: verdict.label })}
            className={`font-medium underline ${TONE_CLASSES[verdict.tone]}`}
          >
            {text}
          </a>
        ) : (
          <span key={verdict.key} className="text-ink-muted">
            {text}
          </span>
        );
      })}
      <span className="text-ink-muted">of {health.calls}</span>
    </p>
  );
}

function share(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function Figure({
  label,
  value,
  tone = 'plain',
  note,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
  readonly note?: string;
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-canvas p-3 ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${TONE_CLASSES[tone]}`}>{value}</p>
      {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
      {children}
    </div>
  );
}

/** WhatsApp (2026-11-23): 95% of messages answered within 5 s; the voice agents: typical reply. */
function ReplyFigure({
  health,
  replyP50Ms,
  replyAimMs,
}: {
  readonly health: AgentHealth;
  readonly replyP50Ms: number | null;
  readonly replyAimMs: number;
}): React.JSX.Element {
  if (health.agent === 'whatsapp') {
    const p95 = health.replyP95Ms;
    return (
      <Figure
        label="95% answered within"
        value={p95 === null ? 'n/a' : `${(p95 / 1000).toFixed(1)} s`}
        tone={p95 === null ? 'plain' : whatsappSlow(health) ? 'warn' : 'good'}
        note={`target ${health.replyTargetMs / 1000} s`}
      />
    );
  }
  return (
    <Figure
      label="Reply time, typical"
      value={replyP50Ms === null ? 'n/a' : `${(replyP50Ms / 1000).toFixed(1)} s`}
      tone={replyP50Ms === null ? 'plain' : replyP50Ms <= replyAimMs ? 'good' : 'warn'}
      note={`aim ≤ ${replyAimMs / 1000} s`}
    />
  );
}

function Figures({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  const { verdicts, calls, replyP50Ms, averageCostInr, guardrailFails } = health;
  const { one, many, replyAimMs, costAimInr } = AGENTS[health.agent];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure
        label="Went well"
        value={share(verdicts.good, calls)}
        tone={verdicts.failed > 0 ? 'warn' : 'good'}
      >
        <VerdictLinks health={health} />
      </Figure>
      <Figure
        label="Guardrail fails"
        value={String(guardrailFails)}
        tone={guardrailFails > 0 ? 'bad' : 'good'}
        note={`${many} with at least one`}
      />
      <ReplyFigure health={health} replyP50Ms={replyP50Ms} replyAimMs={replyAimMs} />
      <Figure
        label={`Cost per ${one}`}
        value={averageCostInr === null ? 'n/a' : formatInr(averageCostInr)}
        tone={averageCostInr === null ? 'plain' : averageCostInr <= costAimInr ? 'good' : 'warn'}
        note={`aim ≤ ${formatInr(costAimInr)}`}
      />
    </div>
  );
}

function problemsTitle(health: AgentHealth): string {
  const flagged = health.verdicts.check + health.verdicts.failed;
  const { one, many } = AGENTS[health.agent];
  return flagged === 1 ? `Why 1 ${one} needs a look` : `Why ${flagged} ${many} need a look`;
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
          <th className={HEAD}>{AGENTS[health.agent].many}</th>
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
              <a
                href={callsHref(health.agent, { ids: problem.callIds, label: problem.label })}
                className="font-medium text-brand underline"
              >
                {callCount(problem.callIds.length, health.agent)}
              </a>
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

/** The daily chart says little until calls are spread over a week or more (Saim, 2026-11-23):
 * it shows once at least this many of the last 14 days had a call. */
export const TREND_MIN_DAYS = 7;

export function hasEnoughTrend(health: AgentHealth): boolean {
  const active = health.trend.filter((day) => day.good + day.check + day.failed > 0);
  return active.length >= TREND_MIN_DAYS;
}

/** Tone, prompt versions and the trend: tone and versions only for the voice agents; the trend
 * only once there is enough of it. */
function Details({ health }: { readonly health: AgentHealth }): React.JSX.Element | null {
  const voiceAgent = AGENTS[health.agent].voiceAgent;
  const trend = hasEnoughTrend(health);
  const columns = (voiceAgent ? 2 : 0) + (trend ? 1 : 0);
  if (columns === 0) return null;
  return (
    <div
      className={`grid gap-5 ${columns === 3 ? 'md:grid-cols-3' : columns === 2 ? 'md:grid-cols-2' : ''}`}
    >
      {voiceAgent ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Tone (AI judge)</h3>
          <ToneList health={health} />
        </section>
      ) : null}
      {voiceAgent ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Live calls by prompt version</h3>
          <Versions health={health} />
        </section>
      ) : null}
      {trend ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Last 14 days</h3>
          <Trend health={health} />
        </section>
      ) : null}
    </div>
  );
}

function AgentCard({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  const info = AGENTS[health.agent];
  return (
    <Card title={info.name}>
      <p className="mb-3 text-sm text-ink-muted">
        Last {health.calls} {info.many}
      </p>
      {health.calls === 0 ? (
        <p className="text-sm text-ink-muted">No finished {info.many} yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Figures health={health} />
          {info.voiceAgent ? <ToolSpeeds health={health} /> : null}
          <section>
            <h3 className="text-sm font-semibold">{problemsTitle(health)}</h3>
            <p className="mb-2 text-xs text-ink-muted">
              Counts only the {info.many} that need a look or failed. Small warnings on {info.many}{' '}
              that went well are on their own pages.
            </p>
            <Problems health={health} />
          </section>
          <Details health={health} />
        </div>
      )}
    </Card>
  );
}

function healthSections(summary: HealthSummary): PageSection[] {
  return summary.agents.map((health) => {
    const issues = agentIssues(health).length + health.verdicts.failed;
    return {
      id: health.agent,
      title: AGENTS[health.agent].name,
      badge: issues > 0 ? `⚠ ${issues}` : '✅',
      content: <AgentCard health={health} />,
    };
  });
}

function Summary({ summary }: { readonly summary: HealthSummary }): React.JSX.Element {
  const top = (
    <>
      <TopLine summary={summary} />
      <p className="text-sm text-ink-muted">
        Is each agent doing a good job? Worked out from every finished call&apos;s scorecard. For
        the shared machine (uptime, errors, outside services, spend), see{' '}
        <a href="/ops" className="font-medium text-brand underline">
          Ops
        </a>
        .
      </p>
    </>
  );
  return (
    <>
      <Sections top={top} sections={healthSections(summary)} />
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
