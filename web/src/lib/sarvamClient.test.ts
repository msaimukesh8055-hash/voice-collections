// web/src/lib/sarvamClient.test.ts
import { ACCEPTED_CALL, ACCEPTED_MUNSHI_CALL, OWNER_CALL_ID, TOKEN } from '../test/fixtures.ts';
import type { SarvamProxy } from './appApi.ts';
import {
  type AgentCallbacks,
  type AgentHandle,
  type AgentRequest,
  buildAgentRequest,
  buildMunshiRequest,
  type CallEvents,
  CONNECT_ERROR,
  createSarvamClient,
  DAILY_LIMIT_ERROR,
  MIC_ERROR,
} from './sarvamClient.ts';

const PROXY: SarvamProxy = { baseUrl: 'https://x/v1/sarvam/', headers: { 'x-call-token': TOKEN } };

interface FakeAgent {
  readonly handle: AgentHandle;
  readonly calls: string[];
  callbacks: AgentCallbacks | null;
  request: AgentRequest | null;
}

function fakeAgent(behaviour: { startError?: Error; connects?: boolean } = {}): FakeAgent {
  const fake: FakeAgent = {
    calls: [],
    callbacks: null,
    request: null,
    handle: {
      async start() {
        fake.calls.push('start');
        if (behaviour.startError) throw behaviour.startError;
      },
      async waitForConnect() {
        return behaviour.connects ?? true;
      },
      async stop() {
        fake.calls.push('stop');
      },
      getInteractionId() {
        return 'interaction-1';
      },
    },
  };
  return fake;
}

function recorder(): { events: CallEvents; log: string[] } {
  const log: string[] = [];
  return {
    log,
    events: {
      onPhase: (phase) => log.push(`phase:${phase}`),
      onSpeaking: (speaker) => log.push(`speaking:${speaker ?? 'none'}`),
      onTranscript: (line) => log.push(`${line.speaker}:${line.text}`),
    },
  };
}

async function startCall(fake: FakeAgent, now: () => number = () => 0): Promise<{ log: string[] }> {
  const { events, log } = recorder();
  const client = createSarvamClient(function factory(request, callbacks) {
    fake.request = request;
    fake.callbacks = callbacks;
    return fake.handle;
  }, now);
  await client.start(ACCEPTED_CALL, PROXY, events);
  return { log };
}

describe('buildAgentRequest', () => {
  it('passes the token as an agent variable and greets in the shopkeeper language', () => {
    const request = buildAgentRequest(ACCEPTED_CALL, PROXY);
    expect(request.variables).toEqual({
      call_token: TOKEN,
      shopkeeper_name: 'Ramesh',
      shop_name: 'Ramesh Kirana',
      owner_name: 'Srinivas Reddy',
      business_name: 'Sri Lakshmi Traders',
      today: 'Monday, 2026-11-02',
    });
    expect(request.languageName).toBe('Telugu');
    expect(request.greeting).toContain('Sri Lakshmi Traders');
    expect(request.greeting).not.toContain('{{');
    expect([request.appId, request.userIdentifier, request.proxy]).toEqual(['app', TOKEN, PROXY]);
  });
});

describe('createSarvamClient', () => {
  it('goes connecting then live once the SDK connects', async () => {
    const fake = fakeAgent();
    const { log } = await startCall(fake);
    expect(log).toEqual(['phase:connecting', 'phase:live']);
    expect(fake.calls).toEqual(['start']);
  });

  it('maps transcript roles to Asha and the shopkeeper, skipping empty lines', async () => {
    const fake = fakeAgent();
    const { log } = await startCall(fake);
    fake.callbacks?.onTranscript('bot', ' Namaskaram ');
    fake.callbacks?.onTranscript('user', 'Avunu');
    fake.callbacks?.onTranscript('user', '  ');
    expect(log.slice(2)).toEqual(['asha:Namaskaram', 'shopkeeper:Avunu']);
  });

  it('shows Asha speaking from SDK state and the shopkeeper from mic level', async () => {
    const fake = fakeAgent();
    let clock = 0;
    const { log } = await startCall(fake, () => clock);
    fake.callbacks?.onState('speaking');
    fake.callbacks?.onState('speaking');
    fake.callbacks?.onState('listening');
    fake.callbacks?.onInputLevel(0.3);
    clock = 2000;
    fake.callbacks?.onInputLevel(0.001);
    fake.callbacks?.onState('connected');
    expect(log.slice(2)).toEqual([
      'speaking:asha',
      'speaking:none',
      'speaking:shopkeeper',
      'speaking:none',
    ]);
  });

  it('reports an SDK error and a server-side end only once', async () => {
    const fake = fakeAgent();
    const { log } = await startCall(fake);
    fake.callbacks?.onState('speaking');
    fake.callbacks?.onState('error');
    fake.callbacks?.onEnd();
    fake.callbacks?.onEnd();
    expect(log.slice(2)).toEqual(['speaking:asha', 'phase:error', 'speaking:none', 'phase:ended']);
  });

  it('stops once and returns the interaction id', async () => {
    const fake = fakeAgent();
    const { events } = recorder();
    const client = createSarvamClient(() => fake.handle);
    const session = await client.start(ACCEPTED_CALL, PROXY, events);
    await expect(session.stop()).resolves.toBe('interaction-1');
    await expect(session.stop()).resolves.toBe('interaction-1');
    expect(fake.calls).toEqual(['start', 'stop']);
  });

  it('gives a microphone message when the browser blocks the mic', async () => {
    const blocked = new Error('denied');
    blocked.name = 'NotAllowedError';
    const fake = fakeAgent({ startError: blocked });
    await expect(startCall(fake)).rejects.toThrow(MIC_ERROR);
    expect(fake.calls).toEqual(['start', 'stop']);
  });

  it('gives a connect message when the proxy or SDK fails, or never connects', async () => {
    await expect(startCall(fakeAgent({ startError: new Error('403') }))).rejects.toThrow(
      CONNECT_ERROR,
    );
    const silent = fakeAgent({ connects: false });
    await expect(startCall(silent)).rejects.toThrow(CONNECT_ERROR);
    expect(silent.calls).toEqual(['start', 'stop']);
  });

  it('gives a "try tomorrow" message when the daily live-call cap answers 429', async () => {
    // Same shape as the SDK's RateLimitError (name, code), without loading the SDK.
    const limited = Object.assign(new Error('Rate limit exceeded.'), { code: 'RATE_LIMITED' });
    limited.name = 'RateLimitError';
    const fake = fakeAgent({ startError: limited });
    await expect(startCall(fake)).rejects.toThrow(DAILY_LIMIT_ERROR);
    expect(fake.calls).toEqual(['start', 'stop']);
    const byCode = Object.assign(new Error('429'), { code: 'RATE_LIMITED' });
    await expect(startCall(fakeAgent({ startError: byCode }))).rejects.toThrow(DAILY_LIMIT_ERROR);
  });
});

describe('Munshi (M8)', () => {
  it('passes the owner call token and names, and greets in Telugu with his first name', () => {
    const request = buildMunshiRequest(ACCEPTED_MUNSHI_CALL, PROXY);
    expect(request.variables).toEqual({
      owner_call_token: OWNER_CALL_ID,
      owner_short_name: 'Srinivas',
      owner_name: 'Srinivas Reddy',
      business_name: 'Sri Lakshmi Traders',
      today: 'Saturday, 2026-11-07',
    });
    expect(request.languageName).toBe('Telugu');
    expect(request.greeting).toBe('హా Srinivas అన్నా, మున్షీని. చెప్పండి, ఏం చూడాలి?');
    expect([request.appId, request.userIdentifier]).toEqual(['munshi-app', OWNER_CALL_ID]);
  });

  it('starts the Munshi call through the same connect path', async () => {
    const fake = fakeAgent();
    const { events, log } = recorder();
    const client = createSarvamClient(function factory(request, callbacks) {
      fake.request = request;
      fake.callbacks = callbacks;
      return fake.handle;
    });
    const session = await client.startMunshi(ACCEPTED_MUNSHI_CALL, PROXY, events);
    expect(log).toEqual(['phase:connecting', 'phase:live']);
    expect(fake.request?.appId).toBe('munshi-app');
    await expect(session.stop()).resolves.toBe('interaction-1');
  });
});
