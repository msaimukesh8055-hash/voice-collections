// web/src/features/phone/CallTimer.tsx
// Running call length, like a phone shows during a call.
import { useEffect, useState } from 'react';

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function CallTimer({ startedAt }: { readonly startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(startedAt);

  useEffect(function tickEverySecond() {
    const timer = setInterval(function tick() {
      setNow(Date.now());
    }, 1000);
    return function stopTicking() {
      clearInterval(timer);
    };
  }, []);

  return (
    <span className="tabular-nums text-sm text-ink-muted">
      {formatDuration((now - startedAt) / 1000)}
    </span>
  );
}
