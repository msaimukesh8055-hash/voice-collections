// web/src/features/dashboard/CallsTable.tsx
// A list of calls (dashboard "recent calls", the calls page, one shopkeeper's calls): who, live or
// simulated, status, tone level, length and cost. Each row opens the call's detail page.
import type { CallRow } from '../../lib/dashboardApi.ts';
import { dateTime, duration, formatInr } from './format.ts';

function costText(call: CallRow): string {
  const amount = formatInr(call.cost.inr);
  return call.cost.estimate ? `≈ ${amount}` : amount;
}

export function CallsTable({ calls }: { readonly calls: readonly CallRow[] }): React.JSX.Element {
  if (calls.length === 0) return <p className="text-sm text-ink-muted">No calls yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="py-2 pr-3 font-medium">Shopkeeper</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Tone</th>
            <th className="py-2 pr-3 font-medium">Length</th>
            <th className="py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.id} className="border-t border-border">
              <td className="py-2 pr-3">
                <a className="font-medium text-brand underline" href={`/calls?id=${call.id}`}>
                  {dateTime(call.queuedAt)}
                </a>
              </td>
              <td className="py-2 pr-3">{call.shopkeeperName}</td>
              <td className="py-2 pr-3">
                {call.mode === 'simulated' ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                    simulated
                  </span>
                ) : (
                  'live'
                )}
              </td>
              <td className="py-2 pr-3">{call.status.replace('_', ' ')}</td>
              <td className="py-2 pr-3">Level {call.toneLevel}</td>
              <td className="py-2 pr-3">{duration(call.durationSeconds)}</td>
              <td className="py-2 text-right tabular-nums">{costText(call)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
