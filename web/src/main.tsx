// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { loadAppConfig } from './config.ts';
import { createCallsApi } from './lib/callsApi.ts';
import { createVapiClient } from './lib/vapiClient.ts';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

const config = loadAppConfig();
const client = createVapiClient(config.vapiPublicKey, config.assistantId);
const api = createCallsApi({
  baseUrl: config.callsApiUrl,
  anonKey: config.supabaseAnonKey,
  region: config.supabaseRegion,
});

createRoot(rootElement).render(
  <StrictMode>
    <App client={client} api={api} />
  </StrictMode>,
);
