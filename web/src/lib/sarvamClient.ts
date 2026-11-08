// web/src/lib/sarvamClient.ts
// Wraps the Sarvam Voice Agents SDK behind a small VoiceClient so the phone page can be tested
// with a fake. The SDK itself is created by an AgentFactory (sarvamBrowser.ts in the app, a fake
// in tests). The SDK fetches its call URL through our calls-api proxy with the call token; the
// Sarvam key never reaches the browser (ADR-0012).
import { renderGreeting } from '@voice-agents/asha/greetings.ts';
import { renderMunshiGreeting } from '@voice-agents/munshi/greetings.ts';
import { CALL_TOKEN_VARIABLE, OWNER_CALL_TOKEN_VARIABLE } from '@shared/sarvam.ts';
import { SARVAM_LANGUAGE_NAMES } from '@shared/schemas/shopkeeper.ts';
import type { AcceptedCall, AcceptedMunshiCall, SarvamProxy } from './appApi.ts';
import { createSpeechDetector } from './micLevel.ts';

const CONNECT_TIMEOUT_SECONDS = 15;
export const MIC_ERROR = 'Microphone blocked. Allow microphone access for this page and try again.';
export const CONNECT_ERROR = 'Could not connect the call. Please try again.';
/** The proxy's always-on daily cap on live sessions (429 RATE_LIMITED, CP2 M3, ADR-0012). */
export const DAILY_LIMIT_ERROR =
  "Today's live call limit has been reached. Please try again tomorrow.";

/** Plain-string views of the SDK's enums, so this file never imports the SDK. */
export type SdkRole = 'user' | 'bot';
export type SdkState = 'idle' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'error';
export type SarvamLanguageName = (typeof SARVAM_LANGUAGE_NAMES)[keyof typeof SARVAM_LANGUAGE_NAMES];

export interface AgentCallbacks {
  readonly onTranscript: (role: SdkRole, text: string) => void;
  readonly onState: (state: SdkState) => void;
  /** Microphone level (0..1); the SDK only reports it while Asha is not speaking. */
  readonly onInputLevel: (rms: number) => void;
  readonly onEnd: () => void;
}

export interface AgentRequest {
  readonly proxy: SarvamProxy;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly appId: string;
  readonly userIdentifier: string;
  readonly languageName: SarvamLanguageName;
  readonly variables: Readonly<Record<string, string>>;
  readonly greeting: string;
}

export interface AgentHandle {
  readonly start: () => Promise<void>;
  readonly waitForConnect: (timeoutSeconds: number) => Promise<boolean>;
  readonly stop: () => Promise<void>;
  readonly getInteractionId: () => string | undefined;
}

export type AgentFactory = (request: AgentRequest, callbacks: AgentCallbacks) => AgentHandle;

export type CallPhase = 'connecting' | 'live' | 'ended' | 'error';
/** 'asha' is the agent's side of the call (Asha, or Munshi on /munshi); 'shopkeeper' is the
 * person on the page (the shopkeeper, or the owner talking to Munshi). */
export type Speaker = 'asha' | 'shopkeeper';

export interface TranscriptLine {
  readonly speaker: Speaker;
  readonly text: string;
}

export interface CallEvents {
  readonly onPhase: (phase: CallPhase) => void;
  readonly onSpeaking: (speaker: Speaker | null) => void;
  readonly onTranscript: (line: TranscriptLine) => void;
}

export interface VoiceSession {
  /** Hangs up (safe to call twice) and returns Sarvam's interaction id, if one was assigned. */
  readonly stop: () => Promise<string | null>;
}

export interface VoiceClient {
  readonly start: (
    call: AcceptedCall,
    proxy: SarvamProxy,
    events: CallEvents,
  ) => Promise<VoiceSession>;
  /** Munshi, the owner's call line (M8): Telugu greeting, the owner call token as a variable. */
  readonly startMunshi: (
    call: AcceptedMunshiCall,
    proxy: SarvamProxy,
    events: CallEvents,
  ) => Promise<VoiceSession>;
}

export class VoiceCallError extends Error {
  override name = 'VoiceCallError';
}

export function buildAgentRequest(call: AcceptedCall, proxy: SarvamProxy): AgentRequest {
  const names = {
    shopkeeperName: call.shopkeeperName,
    shopName: call.shopName,
    businessName: call.businessName,
  };
  return {
    proxy,
    orgId: call.sarvam.orgId,
    workspaceId: call.sarvam.workspaceId,
    appId: call.sarvam.appId,
    userIdentifier: call.callToken,
    languageName: SARVAM_LANGUAGE_NAMES[call.language],
    variables: {
      [CALL_TOKEN_VARIABLE]: call.callToken,
      shopkeeper_name: call.shopkeeperName,
      shop_name: call.shopName,
      owner_name: call.ownerName,
      business_name: call.businessName,
      today: call.today,
    },
    greeting: renderGreeting(call.language, names),
  };
}

/** Munshi always greets in Telugu and then follows the owner's language (Sarvam switches). */
export function buildMunshiRequest(call: AcceptedMunshiCall, proxy: SarvamProxy): AgentRequest {
  return {
    proxy,
    orgId: call.sarvam.orgId,
    workspaceId: call.sarvam.workspaceId,
    appId: call.sarvam.appId,
    userIdentifier: call.ownerCallToken,
    languageName: SARVAM_LANGUAGE_NAMES.te,
    variables: {
      [OWNER_CALL_TOKEN_VARIABLE]: call.ownerCallToken,
      owner_short_name: call.ownerShortName,
      owner_name: call.ownerName,
      business_name: call.businessName,
      today: call.today,
    },
    greeting: renderMunshiGreeting(call.ownerShortName),
  };
}

function isMicError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(error.name)
  );
}

/** Turns SDK callbacks into phase / speaker / transcript events, each change sent once. */
function createCallbacks(events: CallEvents, now: () => number): AgentCallbacks {
  const detector = createSpeechDetector();
  let speaker: Speaker | null = null;
  let ended = false;

  function setSpeaker(next: Speaker | null): void {
    if (next === speaker) return;
    speaker = next;
    events.onSpeaking(next);
  }

  return {
    onTranscript(role, text) {
      const trimmed = text.trim();
      if (trimmed)
        events.onTranscript({ speaker: role === 'bot' ? 'asha' : 'shopkeeper', text: trimmed });
    },
    onState(state) {
      if (state === 'error') events.onPhase('error');
      if (state === 'speaking') setSpeaker('asha');
      else if (speaker === 'asha') {
        detector.reset();
        setSpeaker(null);
      }
    },
    onInputLevel(rms) {
      setSpeaker(detector.update(rms, now()) ? 'shopkeeper' : null);
    },
    onEnd() {
      if (ended) return;
      ended = true;
      setSpeaker(null);
      events.onPhase('ended');
    },
  };
}

/** The SDK throws its RateLimitError (code RATE_LIMITED) when the proxy answers 429. */
function isRateLimited(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = 'code' in error ? error.code : undefined;
  return error.name === 'RateLimitError' || code === 'RATE_LIMITED';
}

function startErrorMessage(error: unknown): string {
  if (isMicError(error)) return MIC_ERROR;
  return isRateLimited(error) ? DAILY_LIMIT_ERROR : CONNECT_ERROR;
}

async function connect(agent: AgentHandle): Promise<void> {
  try {
    await agent.start();
    if (await agent.waitForConnect(CONNECT_TIMEOUT_SECONDS)) return;
  } catch (error) {
    await agent.stop().catch(() => undefined);
    throw new VoiceCallError(startErrorMessage(error));
  }
  await agent.stop().catch(() => undefined);
  throw new VoiceCallError(CONNECT_ERROR);
}

export function createSarvamClient(
  factory: AgentFactory,
  now: () => number = Date.now,
): VoiceClient {
  async function startRequest(request: AgentRequest, events: CallEvents): Promise<VoiceSession> {
    events.onPhase('connecting');
    const agent = factory(request, createCallbacks(events, now));
    await connect(agent);
    events.onPhase('live');
    let stopped = false;
    return {
      async stop() {
        if (!stopped) {
          stopped = true;
          await agent.stop().catch(() => undefined);
        }
        return agent.getInteractionId() ?? null;
      },
    };
  }

  return {
    start: (call, proxy, events) => startRequest(buildAgentRequest(call, proxy), events),
    startMunshi: (call, proxy, events) => startRequest(buildMunshiRequest(call, proxy), events),
  };
}
