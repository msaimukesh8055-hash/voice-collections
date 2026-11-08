// web/src/features/phone/CallVisual.tsx
// Two drawn faces, the agent (Asha, or Munshi on /munshi) on the left and the person on the
// right, with two lanes between them (Saim's call-screen idea, M7 B2): the top lane points →
// and flows in gold while the agent talks, the bottom lane points ← while the person talks.
// The status line says the same in words, and the lanes and the gold ring still show who is
// speaking with reduced motion on (only the flowing dots stop).
import type { Gender } from '@shared/gender.ts';
import type { Speaker } from '../../lib/sarvamClient.ts';
import { Avatar } from './Avatar.tsx';

interface CallVisualProps {
  readonly speaker: Speaker | null;
  readonly connecting: boolean;
  readonly shopkeeperName: string;
  /** The agent's name; Asha unless the page says otherwise (Munshi, M8). */
  readonly agentName?: string;
  /** Asha is a woman; Munshi is a man (Saim's Decision 1). */
  readonly agentGender?: Gender;
  /** From the explicit name list (_shared/gender.ts); neutral when unknown. */
  readonly personGender?: Gender;
}

type Direction = 'right' | 'left';

const DOT_DELAYS = ['0s', '0.35s', '0.7s'] as const;
const ASHA = 'Asha';

interface StatusInput {
  readonly speaker: Speaker | null;
  readonly connecting: boolean;
  readonly shopkeeperName: string;
  readonly agentName: string;
}

function statusText({ speaker, connecting, shopkeeperName, agentName }: StatusInput): string {
  if (connecting) return 'Connecting…';
  if (speaker === 'asha') return `${agentName} is speaking`;
  if (speaker === 'shopkeeper') return `${shopkeeperName} is speaking`;
  return 'Listening';
}

function Arrowhead({
  direction,
  active,
}: {
  readonly direction: Direction;
  readonly active: boolean;
}): React.JSX.Element {
  const side = direction === 'right' ? 'right-0 border-l-[9px]' : 'left-0 border-r-[9px]';
  const colour = active
    ? direction === 'right'
      ? 'border-l-gold-deep'
      : 'border-r-gold-deep'
    : direction === 'right'
      ? 'border-l-border'
      : 'border-r-border';
  return (
    <span
      aria-hidden="true"
      className={`absolute top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-y-transparent ${side} ${colour}`}
    />
  );
}

/** One lane: a line with an arrowhead; while active it turns deep gold and dots flow along it. */
function Lane({
  direction,
  active,
}: {
  readonly direction: Direction;
  readonly active: boolean;
}): React.JSX.Element {
  const animation = direction === 'right' ? 'animate-flow-right' : 'animate-flow-left';
  return (
    <div
      data-testid={`lane-${direction}`}
      data-active={active ? 'yes' : 'no'}
      className="relative h-4 w-full overflow-hidden"
    >
      <div
        className={`absolute inset-x-1 top-1/2 -translate-y-1/2 ${
          active ? 'h-0.5 bg-gold-deep' : 'h-px bg-border'
        }`}
      />
      <Arrowhead direction={direction} active={active} />
      {active
        ? DOT_DELAYS.map(function renderDot(delay) {
            return (
              <span
                key={delay}
                style={{ animationDelay: delay }}
                className={`absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full bg-gold-deep ${animation}`}
              />
            );
          })
        : null}
    </div>
  );
}

function Lanes({ speaker }: { readonly speaker: Speaker | null }): React.JSX.Element {
  const direction = speaker === 'asha' ? 'right' : speaker === 'shopkeeper' ? 'left' : 'none';
  return (
    <div
      data-testid="speaking-arrow"
      data-direction={direction}
      className="flex flex-1 flex-col gap-2 px-1"
    >
      <Lane direction="right" active={speaker === 'asha'} />
      <Lane direction="left" active={speaker === 'shopkeeper'} />
    </div>
  );
}

function Person({
  name,
  caption,
  children,
}: {
  readonly name: string;
  readonly caption: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <figure className="flex w-24 flex-col items-center gap-2">
      {children}
      <figcaption className="text-center text-sm">
        <span className="block font-semibold">{name}</span>
        <span className="text-xs text-ink-muted">{caption}</span>
      </figcaption>
    </figure>
  );
}

export function CallVisual({
  speaker,
  connecting,
  shopkeeperName,
  agentName = ASHA,
  agentGender = 'female',
  personGender = 'neutral',
}: CallVisualProps): React.JSX.Element {
  const live = connecting ? null : speaker;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center gap-2">
        <Person name={agentName} caption="AI assistant">
          <Avatar name={agentName} gender={agentGender} role="agent" speaking={live === 'asha'} />
        </Person>
        <Lanes speaker={live} />
        <Person name={shopkeeperName} caption="You">
          <Avatar
            name={shopkeeperName}
            gender={personGender}
            role="person"
            speaking={live === 'shopkeeper'}
          />
        </Person>
      </div>
      <p role="status" className="text-sm font-medium text-ink-muted">
        {statusText({ speaker, connecting, shopkeeperName, agentName })}
      </p>
    </div>
  );
}
