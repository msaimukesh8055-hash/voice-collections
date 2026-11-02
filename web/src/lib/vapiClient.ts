// web/src/lib/vapiClient.ts
// Thin wrapper around the Vapi Web SDK. Pages depend on the VoiceClient interface,
// so tests can pass a fake and never open a real call.
import VapiSdk from '@vapi-ai/web';
import type { CallOverrides } from '@voice-agents/vapi-payload.ts';

type Vapi = InstanceType<typeof VapiSdk>;

export type CallStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface TranscriptLine {
  readonly role: 'assistant' | 'user';
  readonly text: string;
}

export interface VoiceEventHandlers {
  readonly onStatus: (status: CallStatus) => void;
  readonly onTranscript: (line: TranscriptLine) => void;
  readonly onAgentSpeaking: (speaking: boolean) => void;
  readonly onError: (message: string) => void;
}

export interface VoiceClient {
  start: (overrides: CallOverrides) => Promise<void>;
  stop: () => Promise<void>;
  subscribe: (handlers: VoiceEventHandlers) => () => void;
}

interface TranscriptMessage {
  readonly type: 'transcript';
  readonly transcriptType: 'partial' | 'final';
  readonly role: 'assistant' | 'user';
  readonly transcript: string;
}

function isFinalTranscript(message: unknown): message is TranscriptMessage {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Partial<TranscriptMessage>;
  return candidate.type === 'transcript' && candidate.transcriptType === 'final';
}

/** When the server ends the call, the SDK reports Daily's "Meeting has ended" as an error. */
function isNormalHangup(error: unknown): boolean {
  return /meeting has ended|"ejected"/i.test(JSON.stringify(error) ?? '');
}

/** The only error text the call page shows: SDK error text can carry provider internals, so it
 * never reaches the screen (CP1 L3). */
const CALL_ERROR_MESSAGE =
  'The call could not continue. Check the microphone permission and try again.';

/**
 * The SDK ships CommonJS (`exports.default = Vapi`). Depending on the bundler, the default
 * import is either the class itself or the whole exports object `{ default: Vapi }`.
 */
export function resolveVapiClass(sdkModule: unknown): typeof VapiSdk {
  const nested = (sdkModule as { readonly default?: unknown }).default;
  return (typeof nested === 'function' ? nested : sdkModule) as typeof VapiSdk;
}

/** Wires SDK events to our handlers; the returned function removes exactly these listeners. */
function listen(vapi: Vapi, handlers: VoiceEventHandlers): () => void {
  function handleCallStart(): void {
    handlers.onStatus('live');
  }
  function handleCallEnd(): void {
    handlers.onStatus('ended');
    handlers.onAgentSpeaking(false);
  }
  function handleSpeechStart(): void {
    handlers.onAgentSpeaking(true);
  }
  function handleSpeechEnd(): void {
    handlers.onAgentSpeaking(false);
  }
  function handleMessage(message: unknown): void {
    if (isFinalTranscript(message))
      handlers.onTranscript({ role: message.role, text: message.transcript });
  }
  function handleError(error: unknown): void {
    if (!isNormalHangup(error)) handlers.onError(CALL_ERROR_MESSAGE);
  }
  vapi.on('call-start', handleCallStart);
  vapi.on('call-end', handleCallEnd);
  vapi.on('speech-start', handleSpeechStart);
  vapi.on('speech-end', handleSpeechEnd);
  vapi.on('message', handleMessage);
  vapi.on('error', handleError);
  // Not removeAllListeners(): the SDK forwards an undefined event name, which removes nothing.
  // That left React StrictMode's first subscription attached and doubled every transcript line.
  return function unsubscribe(): void {
    vapi.removeListener('call-start', handleCallStart);
    vapi.removeListener('call-end', handleCallEnd);
    vapi.removeListener('speech-start', handleSpeechStart);
    vapi.removeListener('speech-end', handleSpeechEnd);
    vapi.removeListener('message', handleMessage);
    vapi.removeListener('error', handleError);
  };
}

export function createVapiClient(publicKey: string, assistantId: string): VoiceClient {
  const VapiClass = resolveVapiClass(VapiSdk);
  const vapi = new VapiClass(publicKey);

  async function start(overrides: CallOverrides): Promise<void> {
    // The SDK's override type is mutable; our config objects are readonly — copy, don't cast.
    await vapi.start(assistantId, structuredClone(overrides) as Parameters<Vapi['start']>[1]);
  }

  async function stop(): Promise<void> {
    await vapi.stop();
  }

  function subscribe(handlers: VoiceEventHandlers): () => void {
    return listen(vapi, handlers);
  }

  return { start, stop, subscribe };
}
