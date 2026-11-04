// web/src/test/fakes.ts
// Fake calls-api and voice client for page tests: they record what the page asked for, and let
// the test play the server's and Sarvam's side.
import type { AppApi, IncomingCall } from '../lib/appApi.ts';
import type { CallEvents, VoiceClient } from '../lib/sarvamClient.ts';
import { ACCEPTED_CALL, TOKEN } from './fixtures.ts';

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
    },
  };
  return fake;
}

export interface FakeVoice {
  readonly client: VoiceClient;
  events: CallEvents | null;
  stops: number;
  startError: Error | null;
}

export function fakeVoice(): FakeVoice {
  const fake: FakeVoice = {
    events: null,
    stops: 0,
    startError: null,
    client: {
      async start(_call, _proxy, events) {
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
      },
    },
  };
  return fake;
}
