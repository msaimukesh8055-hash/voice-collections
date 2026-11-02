// web/src/features/phone/PhonePage.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppApiError } from '../../lib/appApi.ts';
import { MIC_ERROR, VoiceCallError } from '../../lib/sarvamClient.ts';
import { TOKEN } from '../../test/fixtures.ts';
import {
  type FakeApi,
  fakeApi,
  type FakeVoice,
  fakeVoice,
  RINGING_CALL,
} from '../../test/fakes.ts';
import { PhonePage } from './PhonePage.tsx';
import { POLL_MS, RING_TIMEOUT_MS } from './usePhoneCall.ts';

async function advance(ms: number): Promise<void> {
  await act(async function tick() {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function click(name: string): Promise<void> {
  await act(async function press() {
    fireEvent.click(screen.getByRole('button', { name }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function setup(): { api: FakeApi; voice: FakeVoice } {
  const api = fakeApi();
  const voice = fakeVoice();
  render(<PhonePage api={api.api} voice={voice.client} />);
  return { api, voice };
}

async function ring(api: FakeApi): Promise<void> {
  api.incoming = RINGING_CALL;
  await advance(POLL_MS);
}

function waitingHeading(): HTMLElement {
  return screen.getByRole('heading', { name: 'Waiting for a call…' });
}

describe('PhonePage', () => {
  beforeEach(function useFakeClock() {
    vi.useFakeTimers();
  });
  afterEach(function useRealClock() {
    vi.useRealTimers();
  });

  it('waits, then rings when the server has a call', async () => {
    const { api } = setup();
    await advance(0);
    expect(waitingHeading()).toBeInTheDocument();
    await ring(api);
    expect(screen.getByRole('heading', { name: 'Sri Lakshmi Traders' })).toBeInTheDocument();
    expect(api.requests.filter((request) => request === 'incoming')).toHaveLength(2);
  });

  it('declines the call and goes back to waiting', async () => {
    const { api } = setup();
    await ring(api);
    api.incoming = null;
    await click('Decline');
    expect(api.requests).toContain(`decline:${TOKEN}`);
    expect(screen.getByRole('status')).toHaveTextContent(
      'You declined the call from Sri Lakshmi Traders',
    );
  });

  it('stops ringing after 30 seconds and shows a missed call', async () => {
    const { api } = setup();
    await ring(api);
    api.incoming = null;
    await advance(RING_TIMEOUT_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Missed call from Sri Lakshmi Traders');
  });

  it('accepts, shows who is speaking and the transcript, then hangs up and reports it', async () => {
    const { api, voice } = setup();
    await ring(api);
    await click('Accept');
    expect(api.requests).toContain(`accept:${TOKEN}`);
    await act(async function speak() {
      voice.events?.onSpeaking('asha');
      voice.events?.onTranscript({ speaker: 'asha', text: 'Namaskaram' });
    });
    expect(screen.getByTestId('speaking-arrow')).toHaveAttribute('data-direction', 'right');
    expect(screen.getByText('Namaskaram')).toBeInTheDocument();
    await act(async function reply() {
      voice.events?.onSpeaking('shopkeeper');
    });
    expect(screen.getByTestId('speaking-arrow')).toHaveAttribute('data-direction', 'left');
    expect(screen.getByRole('status')).toHaveTextContent('Ramesh is speaking');
    await advance(65_000);
    expect(screen.getByText('1:05')).toBeInTheDocument();
    await click('End call');
    expect(voice.stops).toBe(1);
    expect(api.requests).toContain(`ended:${TOKEN}:interaction-1:65`);
    expect(screen.getByRole('heading', { name: 'Call ended' })).toBeInTheDocument();
    expect(screen.getByText('Namaskaram')).toBeInTheDocument();
    api.incoming = null;
    await click('Done');
    expect(waitingHeading()).toBeInTheDocument();
  });

  it('closes the call once when Sarvam ends it, with a note if it dropped', async () => {
    const { api, voice } = setup();
    await ring(api);
    await click('Accept');
    await act(async function drop() {
      voice.events?.onPhase('error');
      voice.events?.onPhase('ended');
    });
    expect(screen.getByRole('status')).toHaveTextContent('The call dropped.');
    expect(api.requests.filter((request) => request.startsWith('ended:'))).toHaveLength(1);
    expect(voice.stops).toBe(1);
  });

  it('shows a friendly mic error and closes the call token', async () => {
    const { api, voice } = setup();
    voice.startError = new VoiceCallError(MIC_ERROR);
    await ring(api);
    await click('Accept');
    expect(screen.getByRole('alert')).toHaveTextContent(MIC_ERROR);
    expect(api.requests).toContain(`ended:${TOKEN}:none:0`);
    api.incoming = null;
    await click('Back');
    expect(waitingHeading()).toBeInTheDocument();
  });

  it('shows the server message when the call can no longer be accepted', async () => {
    const { api } = setup();
    await ring(api);
    api.failure = new AppApiError('This call can no longer do that.', 'CALL_STATE_CONFLICT');
    await click('Accept');
    expect(screen.getByRole('alert')).toHaveTextContent('This call can no longer do that.');
  });

  it('says it is retrying when the server cannot be reached', async () => {
    const { api } = setup();
    api.failure = new AppApiError('offline', null);
    await advance(POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Cannot reach the server. Retrying…');
  });
});
