// web/src/App.tsx
// Tiny path switch (no router library yet, M3 plan): /phone is the shopkeeper's phone, anything
// else is the home page.
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { HomePage } from './features/demo/HomePage.tsx';
import { PhonePage } from './features/phone/PhonePage.tsx';
import type { AppApi } from './lib/appApi.ts';
import type { VoiceClient } from './lib/sarvamClient.ts';

export const PHONE_PATH = '/phone';

interface AppProps {
  readonly api: AppApi;
  readonly voice: VoiceClient;
  readonly path: string;
}

export function App({ api, voice, path }: AppProps): React.JSX.Element {
  const onPhone = path.replace(/\/+$/, '') === PHONE_PATH;
  return (
    <ErrorBoundary>
      {onPhone ? <PhonePage api={api} voice={voice} /> : <HomePage api={api} />}
    </ErrorBoundary>
  );
}
