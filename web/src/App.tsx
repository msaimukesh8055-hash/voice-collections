// web/src/App.tsx
// Tiny path switch (no router library for four pages, M6 Decision 9): /phone is the shopkeeper's
// phone; /shopkeepers and /calls are dashboard pages (?id=… opens one); anything else is the
// dashboard.
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CallsPage } from './features/calls/CallsPage.tsx';
import { DashboardPage } from './features/dashboard/DashboardPage.tsx';
import { PhonePage } from './features/phone/PhonePage.tsx';
import { ShopkeepersPage } from './features/shopkeepers/ShopkeepersPage.tsx';
import type { AppApi } from './lib/appApi.ts';
import type { DashboardApi } from './lib/dashboardApi.ts';
import type { VoiceClient } from './lib/sarvamClient.ts';

export const PHONE_PATH = '/phone';

interface AppProps {
  readonly api: AppApi;
  readonly dashboard: DashboardApi;
  readonly voice: VoiceClient;
  readonly path: string;
  /** The address's query string, e.g. "?id=…". */
  readonly search?: string;
}

function Page({ api, dashboard, voice, path, search = '' }: AppProps): React.JSX.Element {
  const route = path.replace(/\/+$/, '') || '/';
  const id = new URLSearchParams(search).get('id');
  if (route === PHONE_PATH) return <PhonePage api={api} voice={voice} />;
  if (route === '/shopkeepers') return <ShopkeepersPage dashboard={dashboard} id={id} />;
  if (route === '/calls') return <CallsPage dashboard={dashboard} id={id} />;
  return <DashboardPage api={api} dashboard={dashboard} />;
}

export function App(props: AppProps): React.JSX.Element {
  return (
    <ErrorBoundary>
      <Page {...props} />
    </ErrorBoundary>
  );
}
