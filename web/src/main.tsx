// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App, MUNSHI_PATH, routeOf } from './App.tsx';
import { loadAppConfig } from './config.ts';
import { createAppApi } from './lib/appApi.ts';
import {
  addressWithoutToken,
  createDashboardApi,
  fetchDevToken,
  readToken,
} from './lib/dashboardApi.ts';
import { createBrowserAgent } from './lib/sarvamBrowser.ts';
import { createSarvamClient } from './lib/sarvamClient.ts';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

const config = loadAppConfig();
const api = createAppApi({
  baseUrl: config.appApiUrl,
  anonKey: config.anonKey,
  region: config.region,
});
const voice = createSarvamClient(createBrowserAgent);

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function clearHash(): void {
  window.history.replaceState(null, '', addressWithoutToken(window.location));
}

// On /munshi the hash holds Munshi's one-time link token: it stays with that page and never
// reaches the dashboard's storage (M8).
const onMunshi = routeOf(window.location.pathname) === MUNSHI_PATH;
const pageHash = window.location.hash;

// The dashboard link's token (#t=…) moves into this tab's storage and out of the address bar.
// `npm run dev` only: with no link, the local Vite server hands out a token. In a production build
// import.meta.env.DEV is false, so this is `undefined` and fetchDevToken is dropped from the bundle.
const dashboard = createDashboardApi({
  baseUrl: config.appApiUrl,
  anonKey: config.anonKey,
  region: config.region,
  token: readToken({ hash: onMunshi ? '' : pageHash, storage: sessionStore(), clearHash }),
  devToken: import.meta.env.DEV ? fetchDevToken : undefined,
});

createRoot(rootElement).render(
  <StrictMode>
    <App
      api={api}
      dashboard={dashboard}
      voice={voice}
      path={window.location.pathname}
      search={window.location.search}
      hash={onMunshi ? pageHash : ''}
      userAgent={window.navigator.userAgent}
    />
  </StrictMode>,
);
