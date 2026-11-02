// web/src/features/phone/phoneState.ts
// What the phone page shows, as one reducer: waiting → ringing → connecting → live → ended
// (or back to waiting after a decline or a missed call). Pure, so every step is unit-tested.
import type { IncomingCall } from '../../lib/appApi.ts';
import type { Speaker, TranscriptLine } from '../../lib/sarvamClient.ts';

export type Screen =
  | { readonly phase: 'waiting'; readonly notice: string | null }
  | { readonly phase: 'ringing'; readonly call: IncomingCall }
  | { readonly phase: 'connecting'; readonly call: IncomingCall }
  | {
      readonly phase: 'live';
      readonly call: IncomingCall;
      readonly startedAt: number;
      readonly shopkeeperName: string;
    }
  | {
      readonly phase: 'ended';
      readonly call: IncomingCall;
      readonly seconds: number;
      readonly note: string | null;
      readonly shopkeeperName: string;
    }
  | { readonly phase: 'error'; readonly message: string };

export interface PhoneView {
  readonly screen: Screen;
  readonly speaker: Speaker | null;
  readonly transcript: readonly TranscriptLine[];
}

export type PhoneAction =
  | { readonly type: 'incoming'; readonly call: IncomingCall }
  | { readonly type: 'notice'; readonly notice: string | null }
  | { readonly type: 'connecting' }
  | { readonly type: 'live'; readonly startedAt: number; readonly shopkeeperName: string }
  | { readonly type: 'speaking'; readonly speaker: Speaker | null }
  | { readonly type: 'line'; readonly line: TranscriptLine }
  | { readonly type: 'ended'; readonly seconds: number; readonly note: string | null }
  | { readonly type: 'failed'; readonly message: string };

export const OFFLINE_NOTICE = 'Cannot reach the server. Retrying…';
export const DROPPED_NOTE = 'The call dropped.';
/** Shown for the shopkeeper until the accepted call tells us their name. */
export const YOU = 'You';

export function missedNotice(callerName: string): string {
  return `Missed call from ${callerName}`;
}

export function declinedNotice(callerName: string): string {
  return `You declined the call from ${callerName}`;
}

export const INITIAL_VIEW: PhoneView = {
  screen: { phase: 'waiting', notice: null },
  speaker: null,
  transcript: [],
};

function callOf(screen: Screen): IncomingCall | null {
  return 'call' in screen ? screen.call : null;
}

function nameOf(screen: Screen): string {
  return screen.phase === 'live' ? screen.shopkeeperName : YOU;
}

type ScreenAction = Exclude<PhoneAction, { readonly type: 'speaking' | 'line' }>;

function nextScreen(screen: Screen, action: ScreenAction): Screen {
  const call = callOf(screen);
  switch (action.type) {
    case 'incoming':
      return screen.phase === 'waiting' ? { phase: 'ringing', call: action.call } : screen;
    case 'notice':
      return { phase: 'waiting', notice: action.notice };
    case 'connecting':
      return screen.phase === 'ringing' ? { phase: 'connecting', call: screen.call } : screen;
    case 'live':
      return screen.phase === 'connecting'
        ? {
            phase: 'live',
            call: screen.call,
            startedAt: action.startedAt,
            shopkeeperName: action.shopkeeperName,
          }
        : screen;
    case 'ended':
      return call && screen.phase !== 'ended'
        ? {
            phase: 'ended',
            call,
            seconds: action.seconds,
            note: action.note,
            shopkeeperName: nameOf(screen),
          }
        : screen;
    case 'failed':
      return { phase: 'error', message: action.message };
  }
}

export function phoneReducer(view: PhoneView, action: PhoneAction): PhoneView {
  if (action.type === 'speaking') return { ...view, speaker: action.speaker };
  if (action.type === 'line') return { ...view, transcript: [...view.transcript, action.line] };
  const screen = nextScreen(view.screen, action);
  if (screen === view.screen) return view;
  // A new ring starts with a clean transcript; an ended call keeps its transcript on screen.
  const transcript = action.type === 'incoming' ? [] : view.transcript;
  const speaker = screen.phase === 'live' ? view.speaker : null;
  return { screen, speaker, transcript };
}
