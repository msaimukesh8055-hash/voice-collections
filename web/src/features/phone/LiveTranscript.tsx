// web/src/features/phone/LiveTranscript.tsx
// The call's words as they are spoken: Asha on the left, the shopkeeper on the right.
import { useEffect, useRef } from 'react';
import type { TranscriptLine } from '../../lib/sarvamClient.ts';

interface LiveTranscriptProps {
  readonly lines: readonly TranscriptLine[];
  readonly shopkeeperName: string;
}

export function LiveTranscript({ lines, shopkeeperName }: LiveTranscriptProps): React.JSX.Element {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(
    function scrollToLatest() {
      endRef.current?.scrollIntoView?.({ block: 'nearest' });
    },
    [lines.length],
  );

  return (
    <section aria-label="Live transcript" className="min-h-0 flex-1">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Transcript
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-ink-muted">Words appear here as you talk.</p>
      ) : (
        <ol aria-live="polite" className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {lines.map(function renderLine(line, index) {
            const isAsha = line.speaker === 'asha';
            return (
              <li
                key={index}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  isAsha ? 'self-start bg-brand-soft' : 'self-end bg-surface ring-1 ring-border'
                }`}
              >
                <span className="block text-xs font-semibold text-ink-muted">
                  {isAsha ? 'Asha' : shopkeeperName}
                </span>
                {line.text}
              </li>
            );
          })}
          <li ref={endRef} aria-hidden="true" />
        </ol>
      )}
    </section>
  );
}
