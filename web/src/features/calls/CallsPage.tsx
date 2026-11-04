// web/src/features/calls/CallsPage.tsx
// /calls: the last 50 calls, or one call when the address has ?id=… (SPEC §12).
import type { CallDetail as Detail, CallRow, DashboardApi } from '../../lib/dashboardApi.ts';
import { CallsTable } from '../dashboard/CallsTable.tsx';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { CallDetail } from './CallDetail.tsx';

function One({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.call(id), `call:${id}`);
  return <LoadState state={state}>{(call: Detail) => <CallDetail call={call} />}</LoadState>;
}

function All({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.calls, 'calls');
  return (
    <LoadState state={state}>
      {(calls: readonly CallRow[]) => (
        <Card title="Calls">
          <CallsTable calls={calls} />
        </Card>
      )}
    </LoadState>
  );
}

export function CallsPage({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
}): React.JSX.Element {
  return (
    <Layout current="/calls">
      {id ? <One dashboard={dashboard} id={id} /> : <All dashboard={dashboard} />}
    </Layout>
  );
}
