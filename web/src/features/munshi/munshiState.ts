// web/src/features/munshi/munshiState.ts
// What the /munshi page shows, as one reducer (M8 A7): checking → ready → connecting → live →
// ended, or used (link used, run out or missing) or error. Pure, so every step is unit-tested.
// Also the page's small pure helpers: the link token from the address, the 8:00 countdown and
// the "1 minute left" moment (the same 7:00 as the wrap-up note munshi-tools adds).
import { OWNER_CALL_TOKEN_PATTERN } from '@shared/auth/owner-call-token.ts';
import { WRAP_UP_AFTER_MS } from '@shared/owner-tools/wrap-up.ts';
import { MAX_OWNER_CALL_SECONDS } from '@voice-agents/schema.ts';
import type { MunshiLinkState } from '../../lib/appApi.ts';
import type { Speaker, TranscriptLine } from '../../lib/sarvamClient.ts';

export type MunshiScreen =
  | { readonly phase: 'checking' }
  | { readonly phase: 'ready' }
  | { readonly phase: 'connecting' }
  | { readonly phase: 'live'; readonly startedAt: number }
  | { readonly phase: 'ended'; readonly seconds: number; readonly note: string | null }
  | { readonly phase: 'used'; readonly message: string }
  | { readonly phase: 'error'; readonly message: string };

export interface MunshiView {
  readonly screen: MunshiScreen;
  readonly speaker: Speaker | null;
  readonly transcript: readonly TranscriptLine[];
}

export type MunshiAction =
  | { readonly type: 'session'; readonly state: MunshiLinkState }
  | { readonly type: 'noLink' }
  | { readonly type: 'connecting' }
  | { readonly type: 'live'; readonly startedAt: number }
  | { readonly type: 'speaking'; readonly speaker: Speaker | null }
  | { readonly type: 'line'; readonly line: TranscriptLine }
  | { readonly type: 'ended'; readonly seconds: number; readonly note: string | null }
  | { readonly type: 'failed'; readonly message: string };

export const MUNSHI = 'Munshi';
export const YOU = 'You';
export const USED_MESSAGE =
  'This link was already used. Tap "📞 Call Munshi" on WhatsApp for a new one.';
export const EXPIRED_MESSAGE =
  'This link has run out. Tap "📞 Call Munshi" on WhatsApp for a new one.';
export const NO_LINK_MESSAGE = 'Open this page from the "📞 Call Munshi" link on WhatsApp.';
export const DROPPED_NOTE = 'The call dropped.';
export const LAST_MINUTE = '1 minute left';
export const IN_APP_HINT =
  'Opened inside WhatsApp? For the microphone, open this page in Chrome (⋮ → Open in Chrome).';

export const INITIAL_MUNSHI_VIEW: MunshiView = {
  screen: { phase: 'checking' },
  speaker: null,
  transcript: [],
};

const HASH_TOKEN = /(?:^#|&)t=([^&]+)/;
/** WhatsApp, Facebook and Instagram open links in their own browser, which often has no mic. */
const IN_APP_BROWSER = /WhatsApp|FBAN|FBAV|Instagram|; wv\)/;

/** The link token from "#t=…", only when it has the signed-link shape; null otherwise. */
export function readMunshiToken(hash: string): string | null {
  const token = HASH_TOKEN.exec(hash)?.[1] ?? null;
  return token !== null && OWNER_CALL_TOKEN_PATTERN.test(token) ? token : null;
}

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER.test(userAgent);
}

/** Seconds left of Munshi's 8 minutes. */
export function secondsLeft(startedAt: number, now: number): number {
  return Math.max(0, MAX_OWNER_CALL_SECONDS - Math.floor((now - startedAt) / 1000));
}

export function isLastMinute(startedAt: number, now: number): boolean {
  return now - startedAt >= WRAP_UP_AFTER_MS;
}

const LINK_SCREENS: Readonly<Record<MunshiLinkState, MunshiScreen>> = {
  ready: { phase: 'ready' },
  used: { phase: 'used', message: USED_MESSAGE },
  expired: { phase: 'used', message: EXPIRED_MESSAGE },
};

type ScreenAction = Exclude<MunshiAction, { readonly type: 'speaking' | 'line' }>;

function nextScreen(screen: MunshiScreen, action: ScreenAction): MunshiScreen {
  switch (action.type) {
    case 'session':
      return screen.phase === 'checking' ? LINK_SCREENS[action.state] : screen;
    case 'noLink':
      return { phase: 'used', message: NO_LINK_MESSAGE };
    case 'connecting':
      return screen.phase === 'ready' ? { phase: 'connecting' } : screen;
    case 'live':
      return screen.phase === 'connecting'
        ? { phase: 'live', startedAt: action.startedAt }
        : screen;
    case 'ended':
      return screen.phase === 'live' || screen.phase === 'connecting'
        ? { phase: 'ended', seconds: action.seconds, note: action.note }
        : screen;
    case 'failed':
      return { phase: 'error', message: action.message };
  }
}

export function munshiReducer(view: MunshiView, action: MunshiAction): MunshiView {
  if (action.type === 'speaking') return { ...view, speaker: action.speaker };
  if (action.type === 'line') return { ...view, transcript: [...view.transcript, action.line] };
  const screen = nextScreen(view.screen, action);
  if (screen === view.screen) return view;
  return { ...view, screen, speaker: screen.phase === 'live' ? view.speaker : null };
}
