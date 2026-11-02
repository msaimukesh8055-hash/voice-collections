// web/src/features/phone/phoneState.test.ts
import type { IncomingCall } from '../../lib/appApi.ts';
import { TOKEN } from '../../test/fixtures.ts';
import { INITIAL_VIEW, type PhoneAction, phoneReducer, type PhoneView } from './phoneState.ts';

const CALL: IncomingCall = { callToken: TOKEN, callerName: 'Sri Lakshmi Traders' };

function run(...actions: PhoneAction[]): PhoneView {
  return actions.reduce(phoneReducer, INITIAL_VIEW);
}

describe('phoneReducer', () => {
  it('walks waiting → ringing → connecting → live → ended', () => {
    const view = run(
      { type: 'incoming', call: CALL },
      { type: 'connecting' },
      { type: 'live', startedAt: 5, shopkeeperName: 'Ramesh' },
      { type: 'ended', seconds: 42, note: null },
    );
    expect(view.screen).toEqual({
      phase: 'ended',
      call: CALL,
      seconds: 42,
      note: null,
      shopkeeperName: 'Ramesh',
    });
  });

  it('ignores steps that do not fit the current screen', () => {
    expect(run({ type: 'connecting' })).toBe(INITIAL_VIEW);
    expect(run({ type: 'live', startedAt: 1, shopkeeperName: 'Ramesh' })).toBe(INITIAL_VIEW);
    expect(run({ type: 'ended', seconds: 1, note: null })).toBe(INITIAL_VIEW);
    const ringing = run({ type: 'incoming', call: CALL });
    expect(phoneReducer(ringing, { type: 'incoming', call: CALL })).toBe(ringing);
    const ended = run(
      { type: 'incoming', call: CALL },
      { type: 'connecting' },
      { type: 'ended', seconds: 0, note: null },
    );
    expect(phoneReducer(ended, { type: 'ended', seconds: 9, note: 'x' })).toBe(ended);
  });

  it('keeps the transcript after the call ends, and clears it on the next ring', () => {
    const line = { speaker: 'asha', text: 'Namaskaram' } as const;
    const ended = run(
      { type: 'incoming', call: CALL },
      { type: 'connecting' },
      { type: 'live', startedAt: 0, shopkeeperName: 'Ramesh' },
      { type: 'line', line },
      { type: 'speaking', speaker: 'asha' },
      { type: 'ended', seconds: 3, note: null },
    );
    expect(ended.transcript).toEqual([line]);
    expect(ended.speaker).toBeNull();
    const back = phoneReducer(ended, { type: 'notice', notice: null });
    expect(phoneReducer(back, { type: 'incoming', call: CALL }).transcript).toEqual([]);
  });

  it('shows an error from any screen', () => {
    expect(run({ type: 'failed', message: 'nope' }).screen).toEqual({
      phase: 'error',
      message: 'nope',
    });
  });
});
