// web/src/App.tsx
// Tiny path switch (no router library for seven pages, M6 Decision 9): /phone is the shopkeeper's
// phone; /munshi is the owner's call line (M8, token in #t=…); /shopkeepers, /calls, /ops and /evals are
// dashboard pages (?id=… opens one); anything else is the dashboard. Every page has the faint
// logo watermark behind it (M7 B2).
import { MUNSHI_PATH } from '@shared/auth/owner-call-token.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Watermark } from './components/Watermark.tsx';
import { CallsPage } from './features/calls/CallsPage.tsx';
import { DashboardPage } from './features/dashboard/DashboardPage.tsx';
import { EvalsPage } from './features/evals/EvalsPage.tsx';
import { OpsPage } from './features/ops/OpsPage.tsx';
import { MunshiPage } from './features/munshi/MunshiPage.tsx';
import { readMunshiToken } from './features/munshi/munshiState.ts';
import { PhonePage } from './features/phone/PhonePage.tsx';
import { ShopkeepersPage } from './features/shopkeepers/ShopkeepersPage.tsx';
import type { AppApi } from './lib/appApi.ts';
import type { DashboardApi } from './lib/dashboardApi.ts';
import type { VoiceClient } from './lib/sarvamClient.ts';

export const PHONE_PATH = '/phone';
export { MUNSHI_PATH };

/** "/munshi/" and "/munshi" are the same page. */
export function routeOf(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

interface AppProps {
  readonly api: AppApi;
  readonly dashboard: DashboardApi;
  readonly voice: VoiceClient;
  readonly path: string;
  /** The address's query string, e.g. "?id=…". */
  readonly search?: string;
  /** The address's hash: on /munshi it carries the link token (#t=…). */
  readonly hash?: string;
  readonly userAgent?: string;
}

function Page(props: AppProps): React.JSX.Element {
  const { api, dashboard, voice, path, search = '', hash = '', userAgent = '' } = props;
  const route = routeOf(path);
  const id = new URLSearchParams(search).get('id');
  if (route === PHONE_PATH) return <PhonePage api={api} voice={voice} />;
  if (route === MUNSHI_PATH) {
    return (
      <MunshiPage api={api} voice={voice} token={readMunshiToken(hash)} userAgent={userAgent} />
    );
  }
  if (route === '/shopkeepers') return <ShopkeepersPage dashboard={dashboard} id={id} />;
  if (route === '/calls') return <CallsPage dashboard={dashboard} id={id} />;
  if (route === '/ops') return <OpsPage dashboard={dashboard} id={id} />;
  if (route === '/evals') return <EvalsPage dashboard={dashboard} />;
  return <DashboardPage api={api} dashboard={dashboard} />;
}

export function App(props: AppProps): React.JSX.Element {
  return (
    <>
      <Watermark />
      <ErrorBoundary>
        <Page {...props} />
      </ErrorBoundary>
    </>
  );
}
