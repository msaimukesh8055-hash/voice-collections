// web/src/features/calls/CallsPage.tsx
// /calls: the last 50 calls, or one call when the address has ?id=… (SPEC §12). From Agent health,
// ?ids=…&label=… shows only those calls (callFilter.tsx).
import type { CallDetail as Detail, CallRow, DashboardApi } from '../../lib/dashboardApi.ts';
import { CallsTable } from '../dashboard/CallsTable.tsx';
import { Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { AddTestCase } from '../evals/AddTestCase.tsx';
import { CallDetail } from './CallDetail.tsx';
import { type CallFilter, FilteredCard, onlyFiltered } from './callFilter.tsx';

function One({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.call(id), `call:${id}`);
  return (
    <LoadState state={state}>
      {(call: Detail) => (
        <CallDetail
          call={call}
          action={<AddTestCase dashboard={dashboard} source="asha_call" refId={call.id} />}
        />
      )}
    </LoadState>
  );
}

function All({
  dashboard,
  filter,
}: {
  readonly dashboard: DashboardApi;
  readonly filter: CallFilter | null;
}): React.JSX.Element {
  const state = useLoad(dashboard.calls, 'calls');
  return (
    <LoadState state={state}>
      {(calls: readonly CallRow[]) => {
        const shown = onlyFiltered(calls, filter);
        return (
          <FilteredCard title="Asha calls" page="/calls" filter={filter} shown={shown.length}>
            <CallsTable calls={shown} />
          </FilteredCard>
        );
      }}
    </LoadState>
  );
}

export function CallsPage({
  dashboard,
  id,
  filter = null,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
  readonly filter?: CallFilter | null;
}): React.JSX.Element {
  return (
    <Layout current="/calls" dashboard={dashboard}>
      {id ? <One dashboard={dashboard} id={id} /> : <All dashboard={dashboard} filter={filter} />}
    </Layout>
  );
}
