// web/src/lib/micLevel.test.ts
import { createSpeechDetector, HOLD_MS, SPEAKING_RMS } from './micLevel.ts';

describe('createSpeechDetector', () => {
  it('stays quiet for background noise', () => {
    const detector = createSpeechDetector();
    expect(detector.update(SPEAKING_RMS / 2, 0)).toBe(false);
  });

  it('lights up on speech and holds briefly between words', () => {
    const detector = createSpeechDetector();
    expect(detector.update(0.2, 1000)).toBe(true);
    expect(detector.update(0.001, 1000 + HOLD_MS)).toBe(true);
    expect(detector.update(0.001, 1001 + HOLD_MS)).toBe(false);
  });

  it('forgets earlier speech after a reset', () => {
    const detector = createSpeechDetector(0.1, 1000);
    detector.update(0.5, 0);
    detector.reset();
    expect(detector.update(0, 10)).toBe(false);
  });
});
