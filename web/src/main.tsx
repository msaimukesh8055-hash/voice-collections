// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { loadAppConfig } from './config.ts';
import { createAppApi } from './lib/appApi.ts';
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

createRoot(rootElement).render(
  <StrictMode>
    <App api={api} voice={voice} path={window.location.pathname} />
  </StrictMode>,
);
