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
  createReplyTimer,
  createSarvamClient,
  DAILY_LIMIT_ERROR,
  MAX_REPLY_TIMES,
  MIC_ERROR,
  USER_INTERRUPT,
  USER_SPEECH_END,
  USER_SPEECH_START,
} from './sarvamClient.ts';
import { MAX_REPLY_WAIT_MS, MIN_REPLY_MS } from './replyTimer.ts';

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

  describe("Sarvam's speech events for the person (M7 B2)", () => {
    it('speech start → the person speaks; speech end → nobody', async () => {
      const fake = fakeAgent();
      const { log } = await startCall(fake);
      fake.callbacks?.onServerEvent(USER_SPEECH_START);
      fake.callbacks?.onServerEvent(USER_SPEECH_END);
      expect(log.slice(2)).toEqual(['speaking:shopkeeper', 'speaking:none']);
    });

    it('an interrupt while the agent speaks: the person wins at once, the agent comes back after', async () => {
      const fake = fakeAgent();
      const { log } = await startCall(fake);
      fake.callbacks?.onState('speaking');
      fake.callbacks?.onServerEvent(USER_INTERRUPT);
      fake.callbacks?.onState('speaking');
      fake.callbacks?.onServerEvent(USER_SPEECH_END);
      fake.callbacks?.onState('listening');
      expect(log.slice(2)).toEqual([
        'speaking:asha',
        'speaking:shopkeeper',
        'speaking:asha',
        'speaking:none',
      ]);
    });

    it('once speech events have arrived, the mic level is ignored', async () => {
      const fake = fakeAgent();
      let clock = 0;
      const { log } = await startCall(fake, () => clock);
      fake.callbacks?.onServerEvent(USER_SPEECH_END);
      fake.callbacks?.onInputLevel(0.3);
      clock = 2000;
      fake.callbacks?.onInputLevel(0.3);
      expect(log.slice(2)).toEqual([]);
    });

    it('other server events change nothing, and the mic level still works without speech events', async () => {
      const fake = fakeAgent();
      const { log } = await startCall(fake);
      fake.callbacks?.onServerEvent('server.event.something_else');
      fake.callbacks?.onInputLevel(0.3);
      expect(log.slice(2)).toEqual(['speaking:shopkeeper']);
    });
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

describe('reply times (live evals)', () => {
  it('measures from the end of the person speaking to Asha speaking, once per reply', () => {
    let clock = 1000;
    const timer = createReplyTimer(() => clock);
    timer.onServerEvent(USER_SPEECH_END);
    clock = 1850;
    timer.onState('speaking');
    timer.onState('listening');
    clock = 2000;
    timer.onState('speaking');
    expect(timer.times()).toEqual([850]);
  });

  it('restarts the wait when the person speaks again before Asha answers', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    timer.onServerEvent(USER_SPEECH_END);
    clock = 400;
    timer.onServerEvent(USER_SPEECH_START);
    clock = 900;
    timer.onServerEvent(USER_SPEECH_END);
    clock = 1600;
    timer.onState('speaking');
    timer.onServerEvent(USER_INTERRUPT);
    clock = 1700;
    timer.onState('speaking');
    expect(timer.times()).toEqual([700]);
  });

  it('keeps at most MAX_REPLY_TIMES replies', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    for (let reply = 0; reply < MAX_REPLY_TIMES + 5; reply += 1) {
      timer.onServerEvent(USER_SPEECH_END);
      clock += MIN_REPLY_MS;
      timer.onState('speaking');
    }
    expect(timer.times()).toHaveLength(MAX_REPLY_TIMES);
  });

  it('without Sarvam speech events, times from the last loud mic moment (2026-11-23)', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    timer.onState('speaking');
    for (clock = 1000; clock <= 2000; clock += 100) timer.onInputLevel(0.2);
    clock = 2300;
    timer.onInputLevel(0.001);
    clock = 3100;
    timer.onState('speaking');
    expect(timer.times()).toEqual([1100]);
  });

  it('ignores a short sound and a reply after a long silence', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    timer.onInputLevel(0.2);
    clock = 100;
    timer.onInputLevel(0.2);
    clock = 900;
    timer.onState('speaking');
    for (clock = 2000; clock <= 3000; clock += 100) timer.onInputLevel(0.2);
    clock = 3000 + MAX_REPLY_WAIT_MS + 1;
    timer.onState('speaking');
    expect(timer.times()).toEqual([]);
  });

  it('a pause shorter than the hold keeps one stretch of speech', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    timer.onInputLevel(0.2);
    clock = 200;
    timer.onInputLevel(0.2);
    clock = 600;
    timer.onInputLevel(0.2);
    clock = 1400;
    timer.onState('speaking');
    expect(timer.times()).toEqual([800]);
  });

  it('a Sarvam "speech started" with no "speech ended" still times from the mic (23 Nov bug)', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    timer.onServerEvent(USER_INTERRUPT);
    timer.onServerEvent(USER_SPEECH_START);
    for (clock = 0; clock <= 1000; clock += 100) timer.onInputLevel(0.2);
    clock = 1500;
    timer.onState('speaking');
    expect(timer.times()).toEqual([500]);
  });

  it('a Sarvam "speech ended" time wins over the mic', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    for (clock = 0; clock <= 1000; clock += 100) timer.onInputLevel(0.2);
    clock = 1200;
    timer.onServerEvent(USER_SPEECH_END);
    clock = 2000;
    timer.onState('speaking');
    expect(timer.times()).toEqual([800]);
  });

  it('quiet speech above the timing level counts; it reports the signals it got', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    for (clock = 0; clock <= 600; clock += 100) timer.onInputLevel(0.02);
    timer.onServerEvent(USER_INTERRUPT);
    timer.onServerEvent('server.event.tool_call');
    clock = 1600;
    timer.onState('speaking');
    expect(timer.times()).toEqual([1000]);
    expect(timer.signals()).toEqual({
      speechStart: 0,
      speechEnd: 0,
      interrupt: 1,
      micSpeech: 1,
      micPeak: 0.02,
      tooFast: 0,
    });
  });

  it('a gap too short to be a reply is left out and counted (23 Nov: 0.02 s "replies")', () => {
    let clock = 0;
    const timer = createReplyTimer(() => clock);
    for (clock = 0; clock <= 600; clock += 100) timer.onInputLevel(0.2);
    clock = 620;
    timer.onState('speaking');
    for (clock = 1000; clock <= 1600; clock += 100) timer.onInputLevel(0.2);
    clock = 1600 + MIN_REPLY_MS;
    timer.onState('speaking');
    expect(timer.times()).toEqual([MIN_REPLY_MS]);
    expect(timer.signals().tooFast).toBe(1);
  });

  it('a live session times replies from the mic level', async () => {
    let clock = 0;
    const fake = fakeAgent();
    const { events } = recorder();
    const client = createSarvamClient(
      function make(_request, callbacks) {
        fake.callbacks = callbacks;
        return fake.handle;
      },
      () => clock,
    );
    const session = await client.startMunshi(ACCEPTED_MUNSHI_CALL, PROXY, events);
    for (clock = 0; clock <= 600; clock += 100) fake.callbacks?.onInputLevel(0.2);
    clock = 1500;
    fake.callbacks?.onState('speaking');
    expect(session.replyTimes()).toEqual([900]);
    expect(session.speechSignals().micSpeech).toBe(1);
  });

  it('a live session reports the reply times it heard', async () => {
    let clock = 0;
    const fake = fakeAgent();
    const { events } = recorder();
    const client = createSarvamClient(
      function make(_request, callbacks) {
        fake.callbacks = callbacks;
        return fake.handle;
      },
      () => clock,
    );
    const session = await client.start(ACCEPTED_CALL, PROXY, events);
    fake.callbacks?.onServerEvent(USER_SPEECH_END);
    clock = 1200;
    fake.callbacks?.onState('speaking');
    expect(session.replyTimes()).toEqual([1200]);
  });
});
