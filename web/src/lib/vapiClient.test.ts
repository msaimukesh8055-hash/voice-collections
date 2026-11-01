// web/src/lib/vapiClient.test.ts
import { collectionsAgent } from '@agent/collections/assistant.config.ts';
import { buildVariantOverrides } from '@agent/vapi-payload.ts';
import { createVapiClient, resolveVapiClass, type VoiceEventHandlers } from './vapiClient.ts';

// Defined inside vi.hoisted because vi.mock runs before normal module code.
const sdk = vi.hoisted(function createSdkFake() {
  type Listener = (payload?: unknown) => void;
  class FakeVapi {
    readonly startCalls: unknown[][] = [];
    stopped = false;
    private listeners = new Map<string, Listener[]>();
    constructor(readonly publicKey: string) {
      instances.push(this);
    }
    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    emit(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }
    removeListener(event: string, listener: Listener): this {
      const remaining = (this.listeners.get(event) ?? []).filter(function keep(existing) {
        return existing !== listener;
      });
      this.listeners.set(event, remaining);
      return this;
    }
    listenerCount(event: string): number {
      return this.listeners.get(event)?.length ?? 0;
    }
    async start(...args: unknown[]): Promise<null> {
      this.startCalls.push(args);
      return null;
    }
    async stop(): Promise<void> {
      this.stopped = true;
    }
  }
  const instances: FakeVapi[] = [];
  return { FakeVapi, instances };
});

type FakeVapi = InstanceType<typeof sdk.FakeVapi>;

vi.mock('@vapi-ai/web', function mockVapiSdk() {
  return { default: sdk.FakeVapi };
});

function recordingHandlers(): VoiceEventHandlers & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    onStatus: (status) => log.push(`status:${status}`),
    onTranscript: (line) => log.push(`${line.role}:${line.text}`),
    onAgentSpeaking: (speaking) => log.push(`speaking:${speaking}`),
    onError: (message) => log.push(`error:${message}`),
  };
}

function latestSdk(): FakeVapi {
  const instance = sdk.instances.at(-1);
  if (!instance) throw new Error('SDK not constructed');
  return instance;
}

describe('createVapiClient', () => {
  it('starts the saved assistant with the chosen language overrides', async () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const overrides = buildVariantOverrides(collectionsAgent, 'hi');
    await client.start(overrides);
    expect(latestSdk().publicKey).toBe('pub-key');
    expect(latestSdk().startCalls[0]).toEqual(['asst_1', overrides]);
  });

  it('stops the call', async () => {
    const client = createVapiClient('pub-key', 'asst_1');
    await client.stop();
    expect(latestSdk().stopped).toBe(true);
  });

  it('maps SDK events to status, speaking and final transcript lines only', () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const handlers = recordingHandlers();
    client.subscribe(handlers);
    const vapi = latestSdk();
    vapi.emit('call-start');
    vapi.emit('speech-start');
    vapi.emit('message', {
      type: 'transcript',
      transcriptType: 'partial',
      role: 'user',
      transcript: 'Hel',
    });
    vapi.emit('message', {
      type: 'transcript',
      transcriptType: 'final',
      role: 'user',
      transcript: 'Hello',
    });
    vapi.emit('speech-end');
    vapi.emit('call-end');
    expect(handlers.log).toEqual([
      'status:live',
      'speaking:true',
      'user:Hello',
      'speaking:false',
      'status:ended',
      'speaking:false',
    ]);
  });

  it('turns SDK errors into short messages, never raw objects', () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const handlers = recordingHandlers();
    client.subscribe(handlers);
    latestSdk().emit('error', { internal: 'stack and tokens' });
    latestSdk().emit('error', new Error('Meeting ended'));
    expect(handlers.log[0]).toMatch(/^error:The call could not continue/);
    expect(handlers.log[1]).toBe('error:Meeting ended');
  });

  it('ignores non-transcript messages and removes listeners on unsubscribe', () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const handlers = recordingHandlers();
    const unsubscribe = client.subscribe(handlers);
    latestSdk().emit('message', null);
    latestSdk().emit('message', { type: 'status-update' });
    unsubscribe();
    latestSdk().emit('call-start');
    expect(handlers.log).toEqual([]);
  });
});

describe('createVapiClient listener lifecycle and hang-ups', () => {
  it('shows each line once after a subscribe, unsubscribe, subscribe cycle (React StrictMode)', () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const handlers = recordingHandlers();
    client.subscribe(handlers)();
    client.subscribe(handlers);
    latestSdk().emit('message', {
      type: 'transcript',
      transcriptType: 'final',
      role: 'assistant',
      transcript: 'Hello.',
    });
    expect(handlers.log).toEqual(['assistant:Hello.']);
    expect(latestSdk().listenerCount('message')).toBe(1);
  });

  it('treats the server ending the meeting as a normal hang-up, not an error', () => {
    const client = createVapiClient('pub-key', 'asst_1');
    const handlers = recordingHandlers();
    client.subscribe(handlers);
    latestSdk().emit('error', {
      type: 'daily-error',
      error: { errorMsg: 'Meeting has ended', error: { type: 'ejected' } },
    });
    expect(handlers.log).toEqual([]);
  });
});

describe('resolveVapiClass', () => {
  it('accepts the class itself or a CommonJS exports object wrapping it', () => {
    expect(resolveVapiClass(sdk.FakeVapi)).toBe(sdk.FakeVapi);
    expect(resolveVapiClass({ default: sdk.FakeVapi })).toBe(sdk.FakeVapi);
  });
});
