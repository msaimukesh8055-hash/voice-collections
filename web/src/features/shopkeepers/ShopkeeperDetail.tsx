// web/src/features/shopkeepers/ShopkeeperDetail.tsx
// One shopkeeper (SPEC §12): what he owes, his reliability score with its four parts (SPEC §9),
// recent ledger entries, promises, the follow-up agent's notes, and his calls.
import type { ShopkeeperDetail as Detail } from '../../lib/dashboardApi.ts';
import { CallsTable } from '../dashboard/CallsTable.tsx';
import { BAND_LABELS, bandClass, formatInr, shortDate } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';

const PARTS = [
  { key: 'paidOnTime', label: 'Paid on time', max: 40 },
  { key: 'promisesKept', label: 'Promises kept', max: 30 },
  { key: 'currentOverdue', label: 'Current overdue', max: 20 },
  { key: 'answersCalls', label: 'Answers calls', max: 10 },
] as const;

function ScoreCard({ detail }: { readonly detail: Detail }): React.JSX.Element {
  const { score } = detail;
  return (
    <Card title="Reliability score">
      <p className="flex items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums">{score.score}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${bandClass(score.band)}`}>
          {BAND_LABELS[score.band]}
        </span>
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {PARTS.map((part) => (
          <li key={part.key}>
            <div className="flex justify-between">
              <span className="text-ink-muted">{part.label}</span>
              <span className="tabular-nums">
                {score.parts[part.key]}/{part.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-brand-soft" aria-hidden="true">
              <div
                className="h-1.5 rounded-full bg-brand"
                style={{ width: `${(score.parts[part.key] / part.max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Owes({ detail }: { readonly detail: Detail }): React.JSX.Element {
  const { dues, shopkeeper } = detail;
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {shopkeeper.shopName} · {shopkeeper.area}
      </p>
      <h1 className="text-2xl font-semibold">{shopkeeper.name}</h1>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{formatInr(dues.outstanding)}</p>
      <p className="text-sm text-ink-muted">
        {dues.overdueAmount > 0
          ? `${formatInr(dues.overdueAmount)} overdue for ${dues.daysOverdue} days`
          : 'Nothing overdue'}
        {dues.nextDueDate
          ? ` · next ${formatInr(dues.nextDueAmount)} on ${shortDate(dues.nextDueDate)}`
          : ''}
      </p>
    </Card>
  );
}

function Entries({ detail }: { readonly detail: Detail }): React.JSX.Element {
  return (
    <Card title="Recent entries">
      <ul className="flex flex-col divide-y divide-border text-sm">
        {detail.entries.map((entry) => (
          <li key={entry.id} className="flex justify-between gap-3 py-2">
            <span>
              {shortDate(entry.entryDate)} · {entry.kind === 'credit' ? 'Credit' : 'Payment'}
              {entry.dueDate ? ` · due ${shortDate(entry.dueDate)}` : ''}
              {entry.status === 'confirmed' ? '' : ` (${entry.status})`}
            </span>
            <span className="tabular-nums">{formatInr(entry.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PromisesAndNotes({ detail }: { readonly detail: Detail }): React.JSX.Element {
  return (
    <Card title="Promises and notes">
      {detail.promises.length === 0 ? (
        <p className="text-sm text-ink-muted">No promises yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {detail.promises.map((promise) => (
            <li key={promise.createdAt}>
              {formatInr(promise.amount)} by {shortDate(promise.promiseDate)} ·{' '}
              <span className="font-medium">{promise.status}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {detail.notes.map((note) => (
          <li key={note.createdAt} className="rounded-xl bg-canvas p-3">
            <span className="block text-xs text-ink-muted">📝 {shortDate(note.createdAt)}</span>
            {note.note}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ShopkeeperDetail({ detail }: { readonly detail: Detail }): React.JSX.Element {
  return (
    <>
      <a href="/shopkeepers" className="text-sm font-medium text-brand underline">
        ← All shopkeepers
      </a>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Owes detail={detail} />
        <ScoreCard detail={detail} />
        <Entries detail={detail} />
        <PromisesAndNotes detail={detail} />
      </div>
      <Card title="Calls">
        <CallsTable calls={detail.calls} />
      </Card>
    </>
  );
}
