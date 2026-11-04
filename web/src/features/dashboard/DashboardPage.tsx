// web/src/features/dashboard/DashboardPage.tsx
// The owner's dashboard (SPEC §12 "/"): KPIs (% collected this month, change vs last week, total
// outstanding, overdue), this month's ring chart, the top 5 overdue with their score, recent
// calls, and the demo controls (the "English under Telugu" switch and "Ring"). The same figures
// as "insights" on WhatsApp, from the same code.
// Dry-run fix 9: the WhatsApp link lands straight on the full dashboard. The Ring box used to sit
// outside the loading state, so it showed alone first and the figures popped in after. Now a
// loading card shows until the overview arrives, and the Ring box comes with the dashboard (or,
// without a valid link, under the "open from WhatsApp" card, so the demo can still ring).
import { useState } from 'react';
import type { AppApi } from '../../lib/appApi.ts';
import type { DashboardApi, Overview } from '../../lib/dashboardApi.ts';
import { DemoControls } from '../demo/DemoControls.tsx';
import { CallsTable } from './CallsTable.tsx';
import { Donut, PART_COLOURS } from './Donut.tsx';
import { BAND_LABELS, bandClass, formatInr } from './format.ts';
import { Card, Layout, LoadState } from './Layout.tsx';
import type { Loaded } from './useLoad.ts';
import { useLoad } from './useLoad.ts';

interface DashboardPageProps {
  readonly api: AppApi;
  readonly dashboard: DashboardApi;
}

function Tile({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

export function weekNote(change: number | null): string | undefined {
  if (change === null) return undefined;
  if (change === 0) return 'Same as last week';
  return change > 0 ? `▲ ${change} points vs last week` : `▼ ${-change} points vs last week`;
}

function Kpis({ overview }: { readonly overview: Overview }): React.JSX.Element {
  const { insights } = overview;
  const percent = insights.percentCollected;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile
        label="Collected this month"
        value={percent === null ? '—' : `${percent}%`}
        note={weekNote(insights.weekChange)}
      />
      <Tile label="Total outstanding" value={formatInr(insights.outstanding)} />
      <Tile label="Overdue this month" value={formatInr(insights.split.overdue)} />
    </div>
  );
}

function MonthChart({ overview }: { readonly overview: Overview }): React.JSX.Element {
  const { split, percentCollected } = overview.insights;
  if (split.total === 0) {
    return (
      <Card title="This month">
        <p className="text-sm text-ink-muted">No credit falls due this month yet.</p>
      </Card>
    );
  }
  const parts = [
    {
      key: 'collected',
      label: 'Collected',
      value: split.collected,
      colour: PART_COLOURS.collected,
    },
    {
      key: 'notYetDue',
      label: 'Not yet due',
      value: split.notYetDue,
      colour: PART_COLOURS.notYetDue,
    },
    { key: 'overdue', label: 'Overdue', value: split.overdue, colour: PART_COLOURS.overdue },
  ];
  return (
    <Card title="This month's credit">
      <Donut parts={parts} centre={percentCollected === null ? '—' : `${percentCollected}%`} />
    </Card>
  );
}

function TopFive({ overview }: { readonly overview: Overview }): React.JSX.Element {
  const { top } = overview.insights;
  return (
    <Card title="Top 5 overdue">
      {top.length === 0 ? (
        <p className="text-sm text-ink-muted">Nobody is overdue.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Shopkeeper</th>
              <th className="py-2 pr-3 text-right font-medium">Overdue</th>
              <th className="py-2 pr-3 text-right font-medium">Days</th>
              <th className="py-2 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row) => (
              <tr key={row.shopkeeper.id} className="border-t border-border">
                <td className="py-2 pr-3">
                  <a
                    href={`/shopkeepers?id=${row.shopkeeper.id}`}
                    className="font-medium text-brand underline"
                  >
                    {row.shopkeeper.name}
                  </a>
                  <span className="block text-xs text-ink-muted">{row.shopkeeper.shopName}</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatInr(row.overdueAmount)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.daysOverdue}</td>
                <td className="py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${bandClass(row.band)}`}>
                    {BAND_LABELS[row.band]}
                    {row.band === 'new' ? '' : ` ${row.score}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function EnglishSwitch({
  dashboard,
  initial,
}: {
  readonly dashboard: DashboardApi;
  readonly initial: boolean;
}): React.JSX.Element {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setOn(await dashboard.setEnglishUnderTelugu(!on));
    } catch {
      setError('Could not change the setting. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleChange(): void {
    void toggle();
  }

  return (
    <Card title="WhatsApp demo setting">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={handleChange}
          className="h-5 w-5 accent-brand"
        />
        English under every Telugu message (Sarvam Translate)
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function DashboardLoading(): React.JSX.Element {
  return (
    <Card>
      <p role="status" className="text-sm text-ink-muted">
        Loading your dashboard…
      </p>
    </Card>
  );
}

/** The demo controls show with the loaded dashboard, or alone when the link is missing; never
 * while the dashboard is still loading. */
function showsDemoAlone(state: Loaded<Overview>): boolean {
  return state.kind === 'needsLink' || state.kind === 'failed';
}

export function DashboardPage({ api, dashboard }: DashboardPageProps): React.JSX.Element {
  const state = useLoad(dashboard.overview, 'overview');
  function renderDashboard(overview: Overview): React.JSX.Element {
    return (
      <>
        <Kpis overview={overview} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <MonthChart overview={overview} />
          <TopFive overview={overview} />
        </div>
        <Card title="Recent calls">
          <CallsTable calls={overview.calls} />
        </Card>
        <DemoControls api={api} />
        <EnglishSwitch dashboard={dashboard} initial={overview.settings.englishUnderTelugu} />
      </>
    );
  }
  return (
    <Layout current="/" dashboard={dashboard}>
      {state.kind === 'loading' ? (
        <DashboardLoading />
      ) : (
        <LoadState state={state}>{renderDashboard}</LoadState>
      )}
      {showsDemoAlone(state) ? <DemoControls api={api} /> : null}
    </Layout>
  );
}
