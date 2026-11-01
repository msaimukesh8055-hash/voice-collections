// web/src/App.tsx
import { VoiceSpikePage } from './features/voice-spike/VoiceSpikePage.tsx';
import type { VoiceClient } from './lib/vapiClient.ts';

export function App({ client }: { readonly client: VoiceClient }): React.JSX.Element {
  return <VoiceSpikePage client={client} />;
}
