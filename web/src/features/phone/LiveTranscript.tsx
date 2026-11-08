// web/src/features/phone/LiveTranscript.tsx
// The call's words as they are spoken: the agent (Asha, or Munshi on /munshi) on the left, the
// person on the page on the right. Sarvam sends a line only when a turn ends, so while someone
// is talking a "…" bubble waits on their side (M7 B2); it sits outside the aria-live list (the
// status line above already says who is speaking).
import { useEffect, useRef } from 'react';
import type { Speaker, TranscriptLine } from '../../lib/sarvamClient.ts';

interface LiveTranscriptProps {
  readonly lines: readonly TranscriptLine[];
  readonly shopkeeperName: string;
  /** The agent's name; Asha unless the page says otherwise (Munshi, M8). */
  readonly agentName?: string;
  /** Who is talking now: their side shows a "…" bubble. Left out on the Call ended screen. */
  readonly speaker?: Speaker | null;
}

const AGENT_BUBBLE = 'self-start bg-brand-soft border-l-2 border-gold';
const PERSON_BUBBLE = 'self-end bg-surface ring-1 ring-border';

function Typing({ speaker }: { readonly speaker: Speaker }): React.JSX.Element {
  return (
    <div
      data-testid="typing"
      data-side={speaker === 'asha' ? 'left' : 'right'}
      aria-hidden="true"
      className={`mt-2 flex w-fit gap-1 rounded-2xl px-3 py-2 text-sm font-semibold text-ink-muted ${
        speaker === 'asha' ? 'mr-auto bg-brand-soft' : 'ml-auto bg-surface ring-1 ring-border'
      }`}
    >
      …
    </div>
  );
}

export function LiveTranscript({
  lines,
  shopkeeperName,
  agentName = 'Asha',
  speaker = null,
}: LiveTranscriptProps): React.JSX.Element {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(
    function scrollToLatest() {
      endRef.current?.scrollIntoView?.({ block: 'nearest' });
    },
    [lines.length],
  );

  return (
    <section aria-label="Live transcript" className="flex min-h-0 flex-1 flex-col">
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
                  isAsha ? AGENT_BUBBLE : PERSON_BUBBLE
                }`}
              >
                <span className="block text-xs font-semibold text-ink-muted">
                  {isAsha ? agentName : shopkeeperName}
                </span>
                {line.text}
              </li>
            );
          })}
          <li ref={endRef} aria-hidden="true" />
        </ol>
      )}
      {speaker ? <Typing speaker={speaker} /> : null}
    </section>
  );
}
