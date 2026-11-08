// web/src/features/phone/DiallingScreen.tsx
// From Accept (phone page) or Start call (Munshi) until Sarvam connects (M7 B2): the agent's
// face breathing, "Connecting to Asha…" / "Calling Munshi…" and three blinking dots. Under
// reduced motion nothing moves; the words carry it.
import type { Gender } from '@shared/gender.ts';
import { Avatar } from './Avatar.tsx';

interface DiallingScreenProps {
  readonly agentName: string;
  readonly agentGender: Gender;
  /** What the screen says, e.g. "Connecting to Asha" (the dots are added). */
  readonly label: string;
}

const DOT_DELAYS = ['0s', '0.2s', '0.4s'] as const;

export function DiallingScreen({
  agentName,
  agentGender,
  label,
}: DiallingScreenProps): React.JSX.Element {
  return (
    <div
      data-testid="dialling"
      className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
    >
      <Avatar name={agentName} gender={agentGender} role="agent" size="lg" pulsing />
      <p role="status" className="text-lg font-semibold">
        {label}…
      </p>
      <div aria-hidden="true" className="flex gap-2">
        {DOT_DELAYS.map(function renderDot(delay) {
          return (
            <span
              key={delay}
              style={{ animationDelay: delay }}
              className="h-2 w-2 animate-dot rounded-full bg-gold-deep"
            />
          );
        })}
      </div>
    </div>
  );
}
