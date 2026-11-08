// web/src/features/munshi/MunshiPage.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppApiError } from '../../lib/appApi.ts';
import { MIC_ERROR, VoiceCallError } from '../../lib/sarvamClient.ts';
import { type FakeApi, fakeApi, type FakeVoice, fakeVoice } from '../../test/fakes.ts';
import { LINK_TOKEN } from '../../test/fixtures.ts';
import { MunshiPage } from './MunshiPage.tsx';
import {
  DROPPED_NOTE,
  EXPIRED_MESSAGE,
  IN_APP_HINT,
  LAST_MINUTE,
  NO_LINK_MESSAGE,
  USED_MESSAGE,
} from './munshiState.ts';
import { WARM_EVERY_MS } from './useMunshiCall.ts';

const CHROME = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari';

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

interface Setup {
  readonly api: FakeApi;
  readonly voice: FakeVoice;
}

async function setup(
  options: { token?: string | null; userAgent?: string; prepare?: (api: FakeApi) => void } = {},
): Promise<Setup> {
  const api = fakeApi();
  const voice = fakeVoice();
  options.prepare?.(api);
  const token = options.token === undefined ? LINK_TOKEN : options.token;
  render(
    <MunshiPage
      api={api.api}
      voice={voice.client}
      token={token}
      userAgent={options.userAgent ?? CHROME}
    />,
  );
  await advance(0);
  return { api, voice };
}

describe('MunshiPage', () => {
  beforeEach(function useFakeClock() {
    vi.useFakeTimers();
  });
  afterEach(function useRealClock() {
    vi.useRealTimers();
  });

  it('checks the link without starting anything, then offers Start call', async () => {
    const { api, voice } = await setup();
    expect(screen.getByRole('button', { name: 'Start call' })).toBeInTheDocument();
    expect(api.requests).toContain(`munshi-session:${LINK_TOKEN}`);
    expect(api.requests.some((request) => request.startsWith('munshi-accept'))).toBe(false);
    expect(voice.started).toEqual([]);
    expect(screen.queryByText(IN_APP_HINT)).not.toBeInTheDocument();
  });

  it('wakes the tool server on open and every 2 minutes', async () => {
    const { api } = await setup();
    expect(api.requests.filter((request) => request === 'munshi-warm')).toHaveLength(1);
    await advance(WARM_EVERY_MS * 2);
    expect(api.requests.filter((request) => request === 'munshi-warm')).toHaveLength(3);
  });

  it('a used, run-out or missing link says to tap Call Munshi again', async () => {
    await setup({
      prepare(api) {
        api.munshiState = 'used';
      },
    });
    expect(screen.getByText(USED_MESSAGE)).toBeInTheDocument();
  });

  it('a run-out link', async () => {
    await setup({
      prepare(api) {
        api.munshiState = 'expired';
      },
    });
    expect(screen.getByText(EXPIRED_MESSAGE)).toBeInTheDocument();
  });

  it('no token: nothing is sent and nothing is warmed', async () => {
    const { api } = await setup({ token: null });
    expect(screen.getByText(NO_LINK_MESSAGE)).toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  it('a server error while checking shows its message', async () => {
    await setup({
      prepare(api) {
        api.failure = new AppApiError('Voice calls are not set up yet.', 'VOICE_NOT_CONFIGURED');
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Voice calls are not set up yet.');
  });

  it('inside WhatsApp, suggests opening in Chrome', async () => {
    await setup({ userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) WhatsApp/2.24' });
    expect(screen.getByText(IN_APP_HINT)).toBeInTheDocument();
  });

  it('Start call accepts the link and talks to Munshi, labelled Munshi and You', async () => {
    const { api, voice } = await setup();
    await click('Start call');
    expect(api.requests).toContain(`munshi-accept:${LINK_TOKEN}`);
    expect(voice.started).toEqual(['munshi']);
    expect(screen.getByLabelText('Time left')).toHaveTextContent('8:00');
    act(function speak() {
      voice.events?.onSpeaking('asha');
      voice.events?.onTranscript({ speaker: 'asha', text: 'హా Srinivas అన్నా' });
      voice.events?.onTranscript({ speaker: 'shopkeeper', text: 'Pending entha?' });
    });
    expect(screen.getByText('Munshi is speaking')).toBeInTheDocument();
    expect(screen.getAllByText('Munshi').length).toBeGreaterThan(1);
    expect(screen.getByText('Pending entha?')).toBeInTheDocument();
  });

  it('shows "1 minute left" from 7:00 and hangs up at 8:00', async () => {
    const { api, voice } = await setup();
    await click('Start call');
    await advance(6 * 60_000 + 59_000);
    expect(screen.queryByText(LAST_MINUTE)).not.toBeInTheDocument();
    await advance(1000);
    expect(screen.getByText(LAST_MINUTE)).toBeInTheDocument();
    expect(screen.getByLabelText('Time left')).toHaveTextContent('1:00');
    await advance(60_000);
    expect(voice.stops).toBe(1);
    expect(screen.getByRole('heading', { name: 'Call ended' })).toBeInTheDocument();
    expect(api.requests).toContain(`munshi-ended:${LINK_TOKEN}:interaction-1:480`);
  });

  it('End call stops once and reports the seconds and interaction id', async () => {
    const { api, voice } = await setup();
    await click('Start call');
    await advance(65_000);
    await click('End call');
    expect(voice.stops).toBe(1);
    expect(api.requests).toContain(`munshi-ended:${LINK_TOKEN}:interaction-1:65`);
    expect(screen.getByText('Munshi · 1:05')).toBeInTheDocument();
  });

  it('a dropped call says so', async () => {
    const { voice } = await setup();
    await click('Start call');
    await act(async function drop() {
      voice.events?.onPhase('error');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(DROPPED_NOTE)).toBeInTheDocument();
  });

  it('Munshi ending the call ends the page too', async () => {
    const { voice } = await setup();
    await click('Start call');
    await act(async function end() {
      voice.events?.onPhase('ended');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('heading', { name: 'Call ended' })).toBeInTheDocument();
  });

  it('a link used in another tab: the conflict is shown, and the other tab’s call is left alone', async () => {
    const { api, voice } = await setup({
      prepare(fake) {
        fake.munshiAcceptFailure = new AppApiError(
          'This call can no longer do that.',
          'CALL_STATE_CONFLICT',
        );
      },
    });
    await click('Start call');
    expect(screen.getByRole('alert')).toHaveTextContent('This call can no longer do that.');
    expect(api.requests.some((request) => request.startsWith('munshi-ended'))).toBe(false);
    expect(voice.started).toEqual([]);
  });

  it('a Start call lost on the network still closes the owner call (it may have been accepted)', async () => {
    const { api } = await setup({
      prepare(fake) {
        fake.munshiAcceptFailure = new AppApiError('Could not reach the server.', null);
      },
    });
    await click('Start call');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(api.requests).toContain(`munshi-ended:${LINK_TOKEN}:none:0`);
  });

  it('a mic failure after accept closes this owner call', async () => {
    const { api, voice } = await setup();
    voice.startError = new VoiceCallError(MIC_ERROR);
    await click('Start call');
    expect(api.requests.filter((request) => request.startsWith('munshi-accept'))).toHaveLength(1);
    expect(api.requests).toContain(`munshi-ended:${LINK_TOKEN}:none:0`);
  });

  it('a double tap on Start call accepts the link once', async () => {
    const { api, voice } = await setup();
    await act(async function doubleTap() {
      const button = screen.getByRole('button', { name: 'Start call' });
      fireEvent.click(button);
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.requests.filter((request) => request.startsWith('munshi-accept'))).toHaveLength(1);
    expect(voice.started).toEqual(['munshi']);
  });

  it('never writes the link token to the console, through a whole call', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(function spyOn(level) {
      return vi.spyOn(console, level);
    });
    await setup();
    await click('Start call');
    await advance(30_000);
    await click('End call');
    const printed = spies.flatMap(function callsOf(spy) {
      return spy.mock.calls.map(function asText(args) {
        return JSON.stringify(args);
      });
    });
    expect(printed.some((line) => line.includes(LINK_TOKEN))).toBe(false);
    for (const spy of spies) spy.mockRestore();
  });

  it('a blocked microphone shows the mic message and the Chrome hint', async () => {
    const { voice } = await setup();
    voice.startError = new VoiceCallError(MIC_ERROR);
    await click('Start call');
    expect(screen.getByRole('alert')).toHaveTextContent(MIC_ERROR);
    expect(screen.getByText(IN_APP_HINT)).toBeInTheDocument();
  });
});
