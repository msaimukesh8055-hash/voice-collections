// web/src/App.tsx
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { VoiceSpikePage } from './features/voice-spike/VoiceSpikePage.tsx';
import type { CallsApi } from './lib/callsApi.ts';
import type { VoiceClient } from './lib/vapiClient.ts';

interface AppProps {
  readonly client: VoiceClient;
  readonly api: CallsApi;
}

export function App({ client, api }: AppProps): React.JSX.Element {
  return (
    <ErrorBoundary>
      <VoiceSpikePage client={client} api={api} />
    </ErrorBoundary>
  );
}
