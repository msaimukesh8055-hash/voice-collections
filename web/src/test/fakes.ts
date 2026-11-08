// web/src/test/fakes.ts
// Fake calls-api and voice client for page tests: they record what the page asked for, and let
// the test play the server's and Sarvam's side.
import type { AppApi, IncomingCall, MunshiLinkState } from '../lib/appApi.ts';
import type { CallEvents, VoiceClient, VoiceSession } from '../lib/sarvamClient.ts';
import { ACCEPTED_CALL, ACCEPTED_MUNSHI_CALL, TOKEN } from './fixtures.ts';

export const RINGING_CALL: IncomingCall = {
  callToken: TOKEN,
  callerName: 'Sri Lakshmi Traders',
  shopkeeperName: 'Ramesh',
  shopName: 'Ramesh Kirana',
};

export interface FakeApi {
  readonly api: AppApi;
  readonly requests: string[];
  incoming: IncomingCall | null;
  failure: Error | null;
  alreadyQueued: boolean;
  /** What /v1/munshi/session answers (M8). */
  munshiState: MunshiLinkState;
  /** Thrown by munshiAccept only (e.g. CALL_STATE_CONFLICT). */
  munshiAcceptFailure: Error | null;
}

function check(fake: FakeApi, request: string): void {
  fake.requests.push(request);
  if (fake.failure) throw fake.failure;
}

export function fakeApi(): FakeApi {
  const fake: FakeApi = {
    requests: [],
    incoming: null,
    failure: null,
    alreadyQueued: false,
    munshiState: 'ready',
    munshiAcceptFailure: null,
    api: {
      async getDemo() {
        check(fake, 'demo');
        return { liveShopkeeper: { name: 'Ramesh', shopName: 'Ramesh Kirana' } };
      },
      async ring() {
        check(fake, 'ring');
        return { alreadyQueued: fake.alreadyQueued };
      },
      async incoming() {
        check(fake, 'incoming');
        return fake.incoming;
      },
      async accept(token) {
        check(fake, `accept:${token}`);
        return ACCEPTED_CALL;
      },
      async decline(token) {
        fake.requests.push(`decline:${token}`);
      },
      async ended(token, report) {
        const seconds = Math.round(report.seconds);
        fake.requests.push(`ended:${token}:${report.interactionId ?? 'none'}:${seconds}`);
      },
      warmTools() {
        fake.requests.push('warm');
      },
      sarvamProxy(token) {
        return { baseUrl: 'https://proxy/', headers: { 'x-call-token': token } };
      },
      ...fakeMunshiSteps(function self() {
        return fake;
      }),
    },
  };
  return fake;
}

/** The /munshi page's steps (M8); `self` returns the fake once it exists. */
function fakeMunshiSteps(
  self: () => FakeApi,
): Pick<AppApi, 'munshiSession' | 'munshiAccept' | 'munshiEnded' | 'warmMunshiTools'> {
  return {
    async munshiSession(linkToken) {
      check(self(), `munshi-session:${linkToken}`);
      return self().munshiState;
    },
    async munshiAccept(linkToken) {
      check(self(), `munshi-accept:${linkToken}`);
      const failure = self().munshiAcceptFailure;
      if (failure) throw failure;
      return ACCEPTED_MUNSHI_CALL;
    },
    async munshiEnded(linkToken, report) {
      const seconds = Math.round(report.seconds);
      self().requests.push(
        `munshi-ended:${linkToken}:${report.interactionId ?? 'none'}:${seconds}`,
      );
    },
    warmMunshiTools() {
      self().requests.push('munshi-warm');
    },
  };
}

export interface FakeVoice {
  readonly client: VoiceClient;
  events: CallEvents | null;
  stops: number;
  startError: Error | null;
  /** Which start was used: 'asha' or 'munshi'. */
  started: string[];
}

async function fakeStart(fake: FakeVoice, events: CallEvents): Promise<VoiceSession> {
  fake.events = events;
  events.onPhase('connecting');
  if (fake.startError) throw fake.startError;
  events.onPhase('live');
  return {
    async stop() {
      fake.stops += 1;
      return 'interaction-1';
    },
  };
}

export function fakeVoice(): FakeVoice {
  const fake: FakeVoice = {
    events: null,
    stops: 0,
    startError: null,
    started: [],
    client: {
      start(_call, _proxy, events) {
        fake.started.push('asha');
        return fakeStart(fake, events);
      },
      startMunshi(_call, _proxy, events) {
        fake.started.push('munshi');
        return fakeStart(fake, events);
      },
    },
  };
  return fake;
}
