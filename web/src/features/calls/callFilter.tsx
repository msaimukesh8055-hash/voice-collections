// web/src/features/calls/callFilter.tsx
// A calls page opened from Agent health (Saim, 2026-11-22): "?ids=a,b,c&label=Need a look" shows
// only those calls, with a chip saying why and a link back to all calls. Agent health is the
// summary; the calls pages stay the one place the calls themselves are listed.
import { Card } from '../dashboard/Layout.tsx';

export interface CallFilter {
  readonly ids: readonly string[];
  readonly label: string;
}

/** The filter in a calls page address, or null for the plain list. */
export function readCallFilter(search: string): CallFilter | null {
  const params = new URLSearchParams(search);
  const ids = (params.get('ids') ?? '').split(',').filter((one) => one !== '');
  if (ids.length === 0) return null;
  return { ids, label: params.get('label') ?? 'Selected calls' };
}

/** The address of a calls page showing just these calls. */
export function filteredCallsHref(page: string, filter: CallFilter): string {
  const params = new URLSearchParams({ ids: filter.ids.join(','), label: filter.label });
  return `${page}?${params.toString()}`;
}

export function onlyFiltered<T extends { readonly id: string }>(
  rows: readonly T[],
  filter: CallFilter | null,
): readonly T[] {
  if (!filter) return rows;
  const wanted = new Set(filter.ids);
  return rows.filter((row) => wanted.has(row.id));
}

/** The calls page card, with the filter chip above the list when one is set. */
export function FilteredCard({
  title,
  page,
  filter,
  shown,
  children,
  many = 'calls',
}: {
  readonly title: string;
  readonly page: string;
  readonly filter: CallFilter | null;
  readonly shown: number;
  readonly children: React.ReactNode;
  /** "calls", or "messages" on the WhatsApp page. */
  readonly many?: string;
}): React.JSX.Element {
  const older = filter ? filter.ids.length - shown : 0;
  return (
    <Card title={title}>
      {filter ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-brand-soft px-3 py-0.5 font-medium text-brand">
            Showing: {filter.label} ({filter.ids.length})
          </span>
          <a href={page} className="text-brand underline">
            Show all {many}
          </a>
          {older > 0 ? (
            <span className="text-xs text-ink-muted">
              {older} of these are older than the {many} listed here.
            </span>
          ) : null}
        </p>
      ) : null}
      {children}
    </Card>
  );
}
