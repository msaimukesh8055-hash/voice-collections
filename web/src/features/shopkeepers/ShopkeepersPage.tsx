// web/src/features/shopkeepers/ShopkeepersPage.tsx
// /shopkeepers: the list, or one shopkeeper when the address has ?id=… (SPEC §12).
import type {
  DashboardApi,
  ShopkeeperDetail as Detail,
  ShopkeeperList as List,
} from '../../lib/dashboardApi.ts';
import { Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { ShopkeeperDetail } from './ShopkeeperDetail.tsx';
import { ShopkeeperList } from './ShopkeeperList.tsx';

function One({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.shopkeeper(id), `shopkeeper:${id}`);
  return (
    <LoadState state={state}>{(detail: Detail) => <ShopkeeperDetail detail={detail} />}</LoadState>
  );
}

function All({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.shopkeepers, 'shopkeepers');
  return <LoadState state={state}>{(data: List) => <ShopkeeperList data={data} />}</LoadState>;
}

export function ShopkeepersPage({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
}): React.JSX.Element {
  return (
    <Layout current="/shopkeepers">
      {id ? <One dashboard={dashboard} id={id} /> : <All dashboard={dashboard} />}
    </Layout>
  );
}
