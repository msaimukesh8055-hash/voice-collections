// web/src/features/munshi/useMunshiCall.ts
// The /munshi page's behaviour (M8 A7): check the link once (no state change), wake Munshi's tool
// server on open and every 2 minutes, and on Start call accept the link and start the Sarvam call
// from the click (browsers only allow the mic after a user action). The call ends by End call,
// by Munshi, or at the 8-minute cap; then the seconds and Sarvam's interaction id are reported so
// the owner call is closed and its token stops working for tools. The token is never logged.
import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import { MAX_OWNER_CALL_SECONDS } from '@voice-agents/schema.ts';
import { AppApiError, type AppApi } from '../../lib/appApi.ts';
import type { CallEvents, VoiceClient, VoiceSession } from '../../lib/sarvamClient.ts';
import {
  DROPPED_NOTE,
  INITIAL_MUNSHI_VIEW,
  type MunshiAction,
  munshiReducer,
  type MunshiView,
} from './munshiState.ts';

export const WARM_EVERY_MS = 2 * 60_000;
const FALLBACK_ERROR = 'Something went wrong with the call. Please try again.';

export interface MunshiCall {
  readonly view: MunshiView;
  readonly start: () => Promise<void>;
  readonly hangUp: () => Promise<void>;
}

interface LiveCall {
  readonly token: string;
  session: VoiceSession | null;
  startedAt: number | null;
  finished: boolean;
}

interface CallContext {
  readonly live: LiveCall;
  readonly api: AppApi;
  readonly dispatch: Dispatch<MunshiAction>;
}

/** The server answered "no" (e.g. CALL_STATE_CONFLICT: used in another tab): this page never
 * accepted the link, so it must not close the owner call (it may be live somewhere else). */
function isRefusal(error: unknown): boolean {
  return error instanceof AppApiError && error.code !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

function useLinkCheck(api: AppApi, token: string | null, dispatch: Dispatch<MunshiAction>): void {
  useEffect(
    function checkLink() {
      if (token === null) {
        dispatch({ type: 'noLink' });
        return undefined;
      }
      let active = true;
      api.munshiSession(token).then(
        function showState(state) {
          if (active) dispatch({ type: 'session', state });
        },
        function showError(error: unknown) {
          if (active) dispatch({ type: 'failed', message: messageOf(error) });
        },
      );
      return function ignoreLateReply() {
        active = false;
      };
    },
    [api, token, dispatch],
  );
}

function useWarmTools(api: AppApi, token: string | null): void {
  useEffect(
    function keepToolsWarm() {
      if (token === null) return undefined;
      api.warmMunshiTools();
      const timer = setInterval(function warmAgain() {
        api.warmMunshiTools();
      }, WARM_EVERY_MS);
      return function stopWarming() {
        clearInterval(timer);
      };
    },
    [api, token],
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
  // Closing the owner call is what stops the token working; a failure is covered by the TTL.
  await api.munshiEnded(live.token, { interactionId, seconds }).catch(() => undefined);
}

function callEvents(context: CallContext): CallEvents {
  const { live, dispatch } = context;
  return {
    onPhase(phase) {
      if (phase === 'live') {
        live.startedAt = Date.now();
        dispatch({ type: 'live', startedAt: live.startedAt });
      }
      if (phase === 'ended') void finishCall(context, null);
      if (phase === 'error') void finishCall(context, DROPPED_NOTE);
    },
    onSpeaking: (speaker) => dispatch({ type: 'speaking', speaker }),
    onTranscript: (line) => dispatch({ type: 'line', line }),
  };
}

/** Hangs up at the 8-minute cap if Sarvam has not ended the call by then. */
function useCallCap(startedAt: number | null, hangUp: () => Promise<void>): void {
  const hangUpRef = useRef(hangUp);
  useEffect(function keepLatestHangUp() {
    hangUpRef.current = hangUp;
  });
  useEffect(
    function endAtCap() {
      if (startedAt === null) return undefined;
      const left = MAX_OWNER_CALL_SECONDS * 1000 - (Date.now() - startedAt);
      const timer = setTimeout(
        function capReached() {
          void hangUpRef.current();
        },
        Math.max(0, left),
      );
      return function cancelCap() {
        clearTimeout(timer);
      };
    },
    [startedAt],
  );
}

export function useMunshiCall(api: AppApi, voice: VoiceClient, token: string | null): MunshiCall {
  const [view, dispatch] = useReducer(munshiReducer, INITIAL_MUNSHI_VIEW);
  const liveRef = useRef<LiveCall | null>(null);
  const { screen } = view;
  useLinkCheck(api, token, dispatch);
  useWarmTools(api, token);

  async function start(): Promise<void> {
    // The ref, not the rendered phase, so a double tap starts one call (the phase updates late).
    if (screen.phase !== 'ready' || token === null || liveRef.current !== null) return;
    dispatch({ type: 'connecting' });
    const live: LiveCall = { token, session: null, startedAt: null, finished: false };
    liveRef.current = live;
    let accepted = false;
    try {
      const call = await api.munshiAccept(token);
      accepted = true;
      const events = callEvents({ live, api, dispatch });
      live.session = await voice.startMunshi(call, api.sarvamProxy(token), events);
    } catch (error) {
      live.finished = true;
      dispatch({ type: 'failed', message: messageOf(error) });
      // Close the owner call so its token can't be used: only if this page accepted it, or the
      // accept's answer was lost. A refused accept leaves a call live in another tab alone.
      if (accepted || !isRefusal(error)) {
        await api.munshiEnded(token, { interactionId: null, seconds: 0 }).catch(() => undefined);
      }
    }
  }

  async function hangUp(): Promise<void> {
    const live = liveRef.current;
    if (live) await finishCall({ live, api, dispatch }, null);
  }

  useCallCap(screen.phase === 'live' ? screen.startedAt : null, hangUp);
  return { view, start, hangUp };
}
