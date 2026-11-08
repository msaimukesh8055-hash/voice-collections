// web/src/features/munshi/munshiState.test.ts
import { LINK_TOKEN } from '../../test/fixtures.ts';
import {
  DROPPED_NOTE,
  EXPIRED_MESSAGE,
  INITIAL_MUNSHI_VIEW,
  isInAppBrowser,
  isLastMinute,
  type MunshiAction,
  munshiReducer,
  type MunshiView,
  NO_LINK_MESSAGE,
  readMunshiToken,
  secondsLeft,
  USED_MESSAGE,
} from './munshiState.ts';

function run(actions: readonly MunshiAction[], from: MunshiView = INITIAL_MUNSHI_VIEW): MunshiView {
  return actions.reduce(munshiReducer, from);
}

const LIVE: readonly MunshiAction[] = [
  { type: 'session', state: 'ready' },
  { type: 'connecting' },
  { type: 'live', startedAt: 1000 },
];

describe('munshiReducer', () => {
  it('checks the link, then shows ready, used or run out', () => {
    expect(INITIAL_MUNSHI_VIEW.screen).toEqual({ phase: 'checking' });
    expect(run([{ type: 'session', state: 'ready' }]).screen).toEqual({ phase: 'ready' });
    expect(run([{ type: 'session', state: 'used' }]).screen).toEqual({
      phase: 'used',
      message: USED_MESSAGE,
    });
    expect(run([{ type: 'session', state: 'expired' }]).screen).toEqual({
      phase: 'used',
      message: EXPIRED_MESSAGE,
    });
    expect(run([{ type: 'noLink' }]).screen).toEqual({ phase: 'used', message: NO_LINK_MESSAGE });
  });

  it('a late session reply never moves a started call', () => {
    const view = run([...LIVE, { type: 'session', state: 'expired' }]);
    expect(view.screen).toEqual({ phase: 'live', startedAt: 1000 });
  });

  it('ready → connecting → live → ended, keeping the transcript', () => {
    const line = { speaker: 'asha', text: 'హా Srinivas అన్నా' } as const;
    const view = run([
      ...LIVE,
      { type: 'speaking', speaker: 'asha' },
      { type: 'line', line },
      { type: 'ended', seconds: 42, note: null },
    ]);
    expect(view.screen).toEqual({ phase: 'ended', seconds: 42, note: null });
    expect(view.transcript).toEqual([line]);
    expect(view.speaker).toBeNull();
  });

  it('only a ready link connects, only a connecting call goes live', () => {
    expect(run([{ type: 'connecting' }]).screen).toEqual({ phase: 'checking' });
    expect(
      run([
        { type: 'session', state: 'ready' },
        { type: 'live', startedAt: 1 },
      ]).screen,
    ).toEqual({ phase: 'ready' });
  });

  it('ends from connecting too (dropped), but not twice or from ready', () => {
    const dropped = run([
      { type: 'session', state: 'ready' },
      { type: 'connecting' },
      { type: 'ended', seconds: 0, note: DROPPED_NOTE },
    ]);
    expect(dropped.screen).toEqual({ phase: 'ended', seconds: 0, note: DROPPED_NOTE });
    const again = munshiReducer(dropped, { type: 'ended', seconds: 9, note: null });
    expect(again).toBe(dropped);
    expect(
      run([
        { type: 'session', state: 'ready' },
        { type: 'ended', seconds: 1, note: null },
      ]).screen,
    ).toEqual({ phase: 'ready' });
  });

  it('a failure shows its message', () => {
    expect(run([{ type: 'failed', message: 'Microphone blocked.' }]).screen).toEqual({
      phase: 'error',
      message: 'Microphone blocked.',
    });
  });
});

describe('readMunshiToken', () => {
  it('takes only a signed-link-shaped token from #t=', () => {
    expect(readMunshiToken(`#t=${LINK_TOKEN}`)).toBe(LINK_TOKEN);
    expect(readMunshiToken(`#x=1&t=${LINK_TOKEN}`)).toBe(LINK_TOKEN);
    expect(readMunshiToken('')).toBeNull();
    expect(readMunshiToken('#t=1730000000.abc')).toBeNull();
    expect(readMunshiToken(`#t=${LINK_TOKEN}x`)).toBeNull();
  });
});

describe('countdown', () => {
  it('counts 8:00 down to 0 and never below', () => {
    expect(secondsLeft(0, 0)).toBe(480);
    expect(secondsLeft(0, 60_500)).toBe(420);
    expect(secondsLeft(0, 999_000)).toBe(0);
  });

  it('says "1 minute left" from 7:00', () => {
    expect(isLastMinute(0, 419_999)).toBe(false);
    expect(isLastMinute(0, 420_000)).toBe(true);
  });
});

describe('isInAppBrowser', () => {
  it('spots WhatsApp, Facebook, Instagram and Android web views, not Chrome', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; wv) WhatsApp/2.24')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 [FBAN/FBIOS;FBAV/400.0]')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari')).toBe(
      false,
    );
  });
});
