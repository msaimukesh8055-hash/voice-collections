// web/src/features/calls/ToolUse.tsx
// Live evals (Saim, 2026-11-20): "Tools: needed vs ran", above the transcript. One row per Asha
// tool: needed in this call or not, whether it ran and how long it took, and why it was needed
// (the words that called for it, worked out on the server in scorecard-missed.ts). A needed tool
// that never ran is a silent miss and shows in red. The raw sent/got of each call sits below.
import type { CallDetail, Scorecard } from '../../lib/dashboardApi.ts';
import { Card } from '../dashboard/Layout.tsx';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

type Row = Scorecard['toolUse'][number];
type ToolEvent = CallDetail['toolEvents'][number];

function ms(value: number | null): string {
  return value === null ? '?' : `${value} ms`;
}

export function ranLabel(row: Row): string {
  if (row.timesMs.length === 0) return row.needed ? '✗ never ran' : '—';
  if (row.timesMs.length === 1) return `✓ ${ms(row.timesMs[0] ?? null)}`;
  return `✓ ×${row.timesMs.length} (${row.timesMs.map(ms).join(' / ')})`;
}

function UseRow({ row }: { readonly row: Row }): React.JSX.Element {
  const missed = row.status === 'fail';
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3 font-mono text-xs">{row.tool}</td>
      <td className="py-2 pr-3">{row.needed ? 'Yes' : 'No'}</td>
      <td
        className={`whitespace-nowrap py-2 pr-3 font-medium ${TONE_CLASSES[missed ? 'bad' : row.timesMs.length > 0 ? 'good' : 'plain']}`}
      >
        {ranLabel(row)}
      </td>
      <td className={`py-2 ${missed ? TONE_CLASSES.bad : 'text-ink-muted'}`}>{row.why}</td>
    </tr>
  );
}

export function RawCalls({ events }: { readonly events: readonly ToolEvent[] }): React.JSX.Element {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium">
        What each call sent and got back ({events.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {events.map((event) => (
          <li key={`${event.createdAt}:${event.tool}`}>
            <details className="rounded-xl bg-canvas p-3">
              <summary className="cursor-pointer font-medium">
                {event.tool}
                {event.durationMs === null ? '' : ` · ${event.durationMs} ms`}
              </summary>
              <pre className="mt-2 overflow-x-auto text-xs">
                {JSON.stringify({ sent: event.args, got: event.result }, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ToolUse({
  rows,
  events,
}: {
  readonly rows: readonly Row[];
  readonly events: readonly ToolEvent[];
}): React.JSX.Element {
  return (
    <Card title="Tools: needed vs ran">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="pb-1 pr-3 font-medium">Tool</th>
              <th className="pb-1 pr-3 font-medium">Needed?</th>
              <th className="pb-1 pr-3 font-medium">Ran?</th>
              <th className="pb-1 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <UseRow key={row.tool} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <RawCalls events={events} />
    </Card>
  );
}
