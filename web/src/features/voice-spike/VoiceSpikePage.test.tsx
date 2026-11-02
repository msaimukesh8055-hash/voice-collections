// web/src/features/voice-spike/VoiceSpikePage.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CallOverrides } from '@voice-agents/vapi-payload.ts';
import type { AuthoriseResult, CallsApi, CustomerOption } from '../../lib/callsApi.ts';
import type { VoiceClient, VoiceEventHandlers } from '../../lib/vapiClient.ts';
import { VoiceSpikePage } from './VoiceSpikePage.tsx';

const ANITA: CustomerOption = {
  id: 'c0000000-0000-4000-8000-000000000002',
  fullName: 'Anita Desai',
  language: 'en',
  city: 'Mumbai',
};
const RAVI: CustomerOption = {
  id: 'c0000000-0000-4000-8000-000000000001',
  fullName: 'Ravi Sharma',
  language: 'hi',
  city: 'Pune',
};
const TOKEN = 'ca000000-0000-4000-8000-0000000000aa';
const TODAY = 'Sunday, 2026-11-01';

interface FakeClient extends VoiceClient {
  readonly started: CallOverrides[];
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

interface FakeApi extends CallsApi {
  readonly authorised: string[];
}

function allowAll(customerId: string): AuthoriseResult {
  const customer = [ANITA, RAVI].find((candidate) => candidate.id === customerId) ?? ANITA;
  return {
    ok: true,
    call: {
      callToken: TOKEN,
      customerName: customer.fullName,
      language: customer.language,
      today: TODAY,
    },
  };
}

function createFakeApi(decide: (customerId: string) => AuthoriseResult = allowAll): FakeApi {
  const fake: FakeApi = {
    authorised: [],
    async listCustomers() {
      return [ANITA, RAVI];
    },
    async authoriseCall(customerId) {
      fake.authorised.push(customerId);
      return decide(customerId);
    },
  };
  return fake;
}

async function renderPage(
  client = createFakeClient(),
  api: CallsApi = createFakeApi(),
): Promise<FakeClient> {
  render(<VoiceSpikePage client={client} api={api} />);
  await screen.findByRole('option', { name: /Anita Desai/ });
  return client;
}

async function clickStart(): Promise<void> {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start call' })));
}

describe('VoiceSpikePage', () => {
  it('lists customers with their call language and city', async () => {
    await renderPage();
    expect(
      screen.getByRole('option', { name: 'Anita Desai — English · Mumbai' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ravi Sharma — Hindi · Pune' })).toBeInTheDocument();
  });

  it('authorises the chosen customer, then starts the call with token, name and today', async () => {
    const api = createFakeApi();
    const client = await renderPage(createFakeClient(), api);
    await clickStart();
    expect(api.authorised).toEqual([ANITA.id]);
    expect(client.started[0]?.metadata).toEqual({ callToken: TOKEN });
    expect(client.started[0]?.variableValues).toMatchObject({
      customerName: 'Anita Desai',
      today: TODAY,
      callLanguage: 'English',
    });
    expect(client.started[0]?.voice.voiceId).toMatch(/^en-IN-/);
  });

  it('starts a Hindi call for a Hindi-speaking customer', async () => {
    const client = await renderPage();
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: RAVI.id } });
    await clickStart();
    expect(client.started[0]?.transcriber).toMatchObject({
      provider: 'deepgram',
      language: 'multi',
    });
  });

  it('shows the reason and does not start the call when it is blocked', async () => {
    const message = 'Calls are only allowed between 08:00 and 19:00 IST.';
    const api = createFakeApi(() => ({ ok: false, message }));
    const client = await renderPage(createFakeClient(), api);
    await clickStart();
    expect(screen.getByRole('alert')).toHaveTextContent(`Call blocked: ${message}`);
    expect(client.started).toHaveLength(0);
    expect(screen.getByTestId('call-status')).toHaveTextContent('Ready');
  });

  it('shows a server error when authorisation cannot be reached', async () => {
    const api: CallsApi = {
      ...createFakeApi(),
      async authoriseCall() {
        throw new Error('network down');
      },
    };
    await renderPage(createFakeClient(), api);
    await clickStart();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('shows a friendly error when the customer list cannot load', async () => {
    const api: CallsApi = {
      ...createFakeApi(),
      async listCustomers() {
        throw new Error('down');
      },
    };
    render(<VoiceSpikePage client={createFakeClient()} api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server to load customers',
    );
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled();
  });

  it('shows live status and final transcript lines from call events', async () => {
    const client = await renderPage();
    act(() => {
      client.handlers?.onStatus('live');
      client.handlers?.onTranscript({ role: 'user', text: 'Hello Asha' });
    });
    expect(screen.getByTestId('call-status')).toHaveTextContent('Live');
    expect(screen.getByText('Hello Asha')).toBeInTheDocument();
  });

  it('ends the call when End call is clicked', async () => {
    const client = await renderPage();
    act(() => client.handlers?.onStatus('live'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'End call' })));
    expect(client.stopCount).toBe(1);
  });

  it('shows a microphone error instead of crashing when the call cannot start', async () => {
    const client = createFakeClient();
    client.failNextStart = true;
    await renderPage(client);
    await clickStart();
    expect(screen.getByRole('alert')).toHaveTextContent('Allow microphone access');
  });

  it('locks the customer choice during a call', async () => {
    const client = await renderPage();
    act(() => client.handlers?.onStatus('live'));
    expect(screen.getByLabelText('Customer')).toBeDisabled();
  });
});
