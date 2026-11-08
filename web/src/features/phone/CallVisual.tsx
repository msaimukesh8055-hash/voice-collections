// web/src/features/phone/CallVisual.tsx
// Two avatars, the agent (Asha, or Munshi on /munshi) on the left and the person on the right,
// with an arrow between them that flows from whoever is speaking (Saim's call-screen idea). While
// connecting, the arrow waits.
import type { Speaker } from '../../lib/sarvamClient.ts';

interface CallVisualProps {
  readonly speaker: Speaker | null;
  readonly connecting: boolean;
  readonly shopkeeperName: string;
  /** The agent's name; Asha unless the page says otherwise (Munshi, M8). */
  readonly agentName?: string;
}

interface AvatarProps {
  readonly label: string;
  readonly caption: string;
  readonly speaking: boolean;
  readonly tone: 'brand' | 'ink';
}

const DOT_DELAYS = ['0s', '0.35s', '0.7s'] as const;
const ASHA = 'Asha';

function Avatar({ label, caption, speaking, tone }: AvatarProps): React.JSX.Element {
  const colours = tone === 'brand' ? 'bg-brand text-white' : 'bg-ink-muted text-white';
  return (
    <figure className="flex w-24 flex-col items-center gap-2">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold transition-shadow ${colours} ${
          speaking ? 'ring-4 ring-brand/40 shadow-lg' : 'ring-0'
        }`}
      >
        {label.charAt(0)}
      </div>
      <figcaption className="text-center text-sm">
        <span className="block font-semibold">{label}</span>
        <span className="text-xs text-ink-muted">{caption}</span>
      </figcaption>
    </figure>
  );
}

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

function Flow({ speaker }: { readonly speaker: Speaker | null }): React.JSX.Element {
  const animation = speaker === 'asha' ? 'animate-flow-right' : 'animate-flow-left';
  return (
    <div
      data-testid="speaking-arrow"
      data-direction={speaker === 'asha' ? 'right' : speaker === 'shopkeeper' ? 'left' : 'none'}
      className="relative h-6 flex-1 overflow-hidden"
    >
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border" />
      {speaker
        ? DOT_DELAYS.map(function renderDot(delay) {
            return (
              <span
                key={delay}
                style={{ animationDelay: delay }}
                className={`absolute left-1/2 top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rounded-full bg-brand ${animation}`}
              />
            );
          })
        : null}
    </div>
  );
}

export function CallVisual({
  speaker,
  connecting,
  shopkeeperName,
  agentName = ASHA,
}: CallVisualProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center gap-2">
        <Avatar
          label={agentName}
          caption="AI assistant"
          speaking={speaker === 'asha'}
          tone="brand"
        />
        <Flow speaker={connecting ? null : speaker} />
        <Avatar
          label={shopkeeperName}
          caption="You"
          speaking={speaker === 'shopkeeper'}
          tone="ink"
        />
      </div>
      <p role="status" className="text-sm font-medium text-ink-muted">
        {statusText({ speaker, connecting, shopkeeperName, agentName })}
      </p>
    </div>
  );
}
