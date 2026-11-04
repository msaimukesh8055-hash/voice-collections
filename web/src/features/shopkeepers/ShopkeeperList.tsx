// web/src/features/shopkeepers/ShopkeeperList.tsx
// All shopkeepers, biggest balance first, with a name or shop search (SPEC §12 /shopkeepers).
import { useState } from 'react';
import type { ShopkeeperList as ShopkeeperListData } from '../../lib/dashboardApi.ts';
import { formatInr } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';

export function matches(
  query: string,
  row: { name: string; shopName: string; area: string },
): boolean {
  const text = query.trim().toLowerCase();
  if (text === '') return true;
  return [row.name, row.shopName, row.area].some((value) => value.toLowerCase().includes(text));
}

type Row = ShopkeeperListData['shopkeepers'][number];

function Rows({ rows }: { readonly rows: readonly Row[] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Shopkeeper</th>
            <th className="py-2 pr-3 font-medium">Area</th>
            <th className="py-2 pr-3 text-right font-medium">Owes</th>
            <th className="py-2 pr-3 text-right font-medium">Overdue</th>
            <th className="py-2 text-right font-medium">Days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-3">
                <a href={`/shopkeepers?id=${row.id}`} className="font-medium text-brand underline">
                  {row.name}
                </a>
                <span className="block text-xs text-ink-muted">{row.shopName}</span>
              </td>
              <td className="py-2 pr-3">{row.area}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatInr(row.outstanding)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {row.overdueAmount > 0 ? formatInr(row.overdueAmount) : '—'}
              </td>
              <td className="py-2 text-right tabular-nums">
                {row.overdueAmount > 0 ? row.daysOverdue : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShopkeeperList({ data }: { readonly data: ShopkeeperListData }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const rows = data.shopkeepers.filter((row) => matches(query, row));

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value);
  }

  return (
    <Card title={`Shopkeepers (${data.shopkeepers.length})`}>
      <label className="mb-3 block text-sm">
        <span className="sr-only">Search</span>
        <input
          type="search"
          value={query}
          onChange={handleSearch}
          placeholder="Search by name, shop or area"
          className="h-10 w-full rounded-xl border border-border bg-canvas px-3 focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>
      <Rows rows={rows} />
      {rows.length === 0 ? <p className="mt-3 text-sm text-ink-muted">No match.</p> : null}
    </Card>
  );
}
