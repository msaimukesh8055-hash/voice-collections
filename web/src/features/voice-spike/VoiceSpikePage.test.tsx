// web/src/features/voice-spike/VoiceSpikePage.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { VariantOverrides } from '@voice-agents/vapi-payload.ts';
import type { VoiceClient, VoiceEventHandlers } from '../../lib/vapiClient.ts';
import { VoiceSpikePage } from './VoiceSpikePage.tsx';

interface FakeClient extends VoiceClient {
  readonly started: VariantOverrides[];
  stopCount: number;
  handlers: VoiceEventHandlers | null;
  failNextStart: boolean;
}

function createFakeClient(): FakeClient {
  const fake: FakeClient = {
    started: [],
    stopCount: 0,
    handlers: null,
    failNextStart: false,
    async start(overrides) {
      if (fake.failNextStart) throw new Error('mic blocked');
      fake.started.push(overrides);
    },
    async stop() {
      fake.stopCount += 1;
    },
    subscribe(handlers) {
      fake.handlers = handlers;
      return function unsubscribe() {
        fake.handlers = null;
      };
    },
  };
  return fake;
}

describe('VoiceSpikePage', () => {
  it('starts an English call by default with the English greeting', async () => {
    const client = createFakeClient();
    render(<VoiceSpikePage client={client} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start call' })));
    expect(client.started[0]?.firstMessage).toContain('AI assistant');
    expect(client.started[0]?.voice.voiceId).toMatch(/^en-IN-/);
  });

  it('starts a Hindi call when that language is chosen', async () => {
    const client = createFakeClient();
    render(<VoiceSpikePage client={client} />);
    fireEvent.click(screen.getByLabelText('Hindi'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start call' })));
    expect(client.started[0]?.transcriber).toMatchObject({
      provider: 'deepgram',
      language: 'multi',
    });
  });

  it('shows live status and final transcript lines from call events', () => {
    const client = createFakeClient();
    render(<VoiceSpikePage client={client} />);
    act(() => {
      client.handlers?.onStatus('live');
      client.handlers?.onTranscript({ role: 'user', text: 'Hello Asha' });
    });
    expect(screen.getByTestId('call-status')).toHaveTextContent('Live');
    expect(screen.getByText('Hello Asha')).toBeInTheDocument();
  });

  it('ends the call when End call is clicked', async () => {
    const client = createFakeClient();
    render(<VoiceSpikePage client={client} />);
    act(() => client.handlers?.onStatus('live'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'End call' })));
    expect(client.stopCount).toBe(1);
  });

  it('shows a friendly error instead of crashing when the call cannot start', async () => {
    const client = createFakeClient();
    client.failNextStart = true;
    render(<VoiceSpikePage client={client} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start call' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Allow microphone access');
  });

  it('locks the language choice during a call', () => {
    const client = createFakeClient();
    render(<VoiceSpikePage client={client} />);
    act(() => client.handlers?.onStatus('live'));
    expect(screen.getByLabelText('English')).toBeDisabled();
  });
});
