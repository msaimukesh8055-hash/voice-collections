// web/src/features/phone/usePhoneCall.ts
// The phone page's behaviour: ask every 2 s whether a call is ringing, stop ringing after 30 s
// (missed), and on Accept start the Sarvam call from the click (browsers only allow the mic and
// audio after a user action). At hang-up, report Sarvam's interaction id and duration so the call
// is closed and its token stops working for tools.
import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import type { AppApi, IncomingCall } from '../../lib/appApi.ts';
import type { CallEvents, VoiceClient, VoiceSession } from '../../lib/sarvamClient.ts';
import {
  declinedNotice,
  DROPPED_NOTE,
  INITIAL_VIEW,
  missedNotice,
  OFFLINE_NOTICE,
  type PhoneAction,
  phoneReducer,
  type PhoneView,
  YOU,
} from './phoneState.ts';

export const POLL_MS = 2000;
export const RING_TIMEOUT_MS = 30_000;
const FALLBACK_ERROR = 'Something went wrong with the call. Please try again.';

export interface PhoneCall {
  readonly view: PhoneView;
  readonly accept: () => Promise<void>;
  readonly decline: () => Promise<void>;
  readonly hangUp: () => Promise<void>;
  readonly reset: () => void;
}

interface LiveCall {
  readonly token: string;
  shopkeeperName: string;
  session: VoiceSession | null;
  startedAt: number | null;
  finished: boolean;
}

interface CallContext {
  readonly live: LiveCall;
  readonly api: AppApi;
  readonly dispatch: Dispatch<PhoneAction>;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

function usePolling(api: AppApi, waiting: boolean, dispatch: Dispatch<PhoneAction>): void {
  useEffect(
    function pollForCalls() {
      if (!waiting) return undefined;
      let active = true;
      let warmedToken: string | null = null;
      async function check(): Promise<void> {
        try {
          const call = await api.incoming();
          if (!active || !call) return;
          if (call.callToken !== warmedToken) {
            warmedToken = call.callToken;
            api.warmTools();
          }
          dispatch({ type: 'incoming', call });
        } catch {
          if (active) dispatch({ type: 'notice', notice: OFFLINE_NOTICE });
        }
      }
      void check();
      const timer = setInterval(check, POLL_MS);
      return function stopPolling() {
        active = false;
        clearInterval(timer);
      };
    },
    [api, waiting, dispatch],
  );
}

function useRingTimeout(ringing: IncomingCall | null, dispatch: Dispatch<PhoneAction>): void {
  useEffect(
    function stopRingingLater() {
      if (!ringing) return undefined;
      const timer = setTimeout(function markMissed() {
        dispatch({ type: 'notice', notice: missedNotice(ringing.callerName) });
      }, RING_TIMEOUT_MS);
      return function cancelTimeout() {
        clearTimeout(timer);
      };
    },
    [ringing, dispatch],
  );
}

async function finishCall(
  { live, api, dispatch }: CallContext,
  note: string | null,
): Promise<void> {
  if (live.finished) return;
  live.finished = true;
  const interactionId = live.session ? await live.session.stop() : null;
  const seconds = live.startedAt === null ? 0 : (Date.now() - live.startedAt) / 1000;
  dispatch({ type: 'ended', seconds: Math.round(seconds), note });
  // Closing the call row is what stops the token working; a failure here is covered by the TTL.
  await api.ended(live.token, { interactionId, seconds }).catch(() => undefined);
}

function callEvents(context: CallContext): CallEvents {
  const { live, dispatch } = context;
  return {
    onPhase(phase) {
      if (phase === 'live') {
        live.startedAt = Date.now();
        dispatch({ type: 'live', startedAt: live.startedAt, shopkeeperName: live.shopkeeperName });
      }
      if (phase === 'ended') void finishCall(context, null);
      if (phase === 'error') void finishCall(context, DROPPED_NOTE);
    },
    onSpeaking: (speaker) => dispatch({ type: 'speaking', speaker }),
    onTranscript: (line) => dispatch({ type: 'line', line }),
  };
}

export function usePhoneCall(api: AppApi, voice: VoiceClient): PhoneCall {
  const [view, dispatch] = useReducer(phoneReducer, INITIAL_VIEW);
  const liveRef = useRef<LiveCall | null>(null);
  const { screen } = view;
  usePolling(api, screen.phase === 'waiting', dispatch);
  useRingTimeout(screen.phase === 'ringing' ? screen.call : null, dispatch);

  async function accept(): Promise<void> {
    if (screen.phase !== 'ringing') return;
    const { callToken } = screen.call;
    dispatch({ type: 'connecting' });
    const live: LiveCall = {
      token: callToken,
      shopkeeperName: YOU,
      session: null,
      startedAt: null,
      finished: false,
    };
    liveRef.current = live;
    try {
      const accepted = await api.accept(callToken);
      live.shopkeeperName = accepted.shopkeeperName;
      const events = callEvents({ live, api, dispatch });
      live.session = await voice.start(accepted, api.sarvamProxy(callToken), events);
    } catch (error) {
      live.finished = true;
      dispatch({ type: 'failed', message: messageOf(error) });
      // Close the call so its token can't be used; harmless if it was never accepted.
      await api.ended(callToken, { interactionId: null, seconds: 0 }).catch(() => undefined);
    }
  }

  async function decline(): Promise<void> {
    if (screen.phase !== 'ringing') return;
    const { call } = screen;
    // Decline first, so the next poll can't see the same call still ringing.
    await api.decline(call.callToken).catch(() => undefined);
    dispatch({ type: 'notice', notice: declinedNotice(call.callerName) });
  }

  async function hangUp(): Promise<void> {
    const live = liveRef.current;
    if (live) await finishCall({ live, api, dispatch }, null);
  }

  function reset(): void {
    liveRef.current = null;
    dispatch({ type: 'notice', notice: null });
  }

  return { view, accept, decline, hangUp, reset };
}
