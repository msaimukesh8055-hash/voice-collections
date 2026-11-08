// web/src/features/phone/Avatar.tsx
// The call screen's drawn faces (M7 B2, Saim's Decision 1): simple flat SVG, drawn here (no
// images, no real people). A female face, a male face, or a neutral head-and-shoulders when the
// gender is not on the explicit list (_shared/gender.ts). The agent (Asha, Munshi) wears a
// headset and carries an "AI" tag; whoever is speaking gets a gold ring. Colours are theme
// tokens only.
import type { Gender } from '@shared/gender.ts';

export type AvatarRole = 'agent' | 'person';
export type AvatarSize = 'md' | 'lg';

interface FaceProps {
  readonly gender: Gender;
  readonly role: AvatarRole;
}

interface AvatarProps extends FaceProps {
  readonly name: string;
  readonly speaking?: boolean;
  readonly size?: AvatarSize;
  /** Dialling: the avatar breathes (still under reduced motion). */
  readonly pulsing?: boolean;
}

const SIZES: Readonly<Record<AvatarSize, string>> = {
  md: 'h-16 w-16',
  lg: 'h-28 w-28',
};

function Eyes(): React.JSX.Element {
  return (
    <g className="fill-ink">
      <circle cx="28" cy="28.5" r="1.4" />
      <circle cx="36" cy="28.5" r="1.4" />
    </g>
  );
}

function Smile(): React.JSX.Element {
  return (
    <path
      d="M28.5 33.5 Q32 36 35.5 33.5"
      className="fill-none stroke-ink"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  );
}

function Headset(): React.JSX.Element {
  return (
    <g className="fill-none stroke-ink" strokeWidth="2" strokeLinecap="round">
      <path d="M19.5 27 C19.5 12.5 44.5 12.5 44.5 27" />
      <rect x="17" y="24" width="4.5" height="8" rx="2" className="fill-ink" />
      <rect x="42.5" y="24" width="4.5" height="8" rx="2" className="fill-ink" />
      <path d="M20 32 Q21 39 28 39" strokeWidth="1.5" />
      <circle cx="29" cy="39" r="1.4" className="fill-ink" />
    </g>
  );
}

function FemaleHair({ layer }: { readonly layer: 'back' | 'front' }): React.JSX.Element {
  return layer === 'back' ? (
    <path
      d="M19 29 C17 13 25 8 32 8 C39 8 47 13 45 29 L46 45 C40 48 24 48 18 45 Z"
      className="fill-hair"
    />
  ) : (
    <path
      d="M20.5 25 C21 15 26 11.5 32 11.5 C38 11.5 43 15 43.5 25 C39 19 31 17.5 20.5 25 Z"
      className="fill-hair"
    />
  );
}

function MaleHair(): React.JSX.Element {
  return (
    <path
      d="M20.5 25 C19.5 14 25.5 10 32 10 C38.5 10 44.5 14 43.5 25 C42 19.5 37.5 17.5 32 17.5 C26.5 17.5 22 19.5 20.5 25 Z"
      className="fill-hair"
    />
  );
}

/** The drawing itself, 64 × 64, clipped to the circle by its container. */
export function Face({ gender, role }: FaceProps): React.JSX.Element {
  const backdrop = role === 'agent' ? 'fill-brand-soft' : 'fill-surface';
  if (gender === 'neutral') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" data-face="neutral" className="h-full w-full">
        <rect width="64" height="64" className={backdrop} />
        <g className="fill-ink-muted">
          <circle cx="32" cy="26" r="11" />
          <path d="M11 64 C11 50 20 43 32 43 C44 43 53 50 53 64 Z" />
        </g>
        {role === 'agent' ? <Headset /> : null}
      </svg>
    );
  }
  const clothes = gender === 'female' ? 'fill-ink-muted' : 'fill-brand';
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" data-face={gender} className="h-full w-full">
      <rect width="64" height="64" className={backdrop} />
      {gender === 'female' ? <FemaleHair layer="back" /> : null}
      <path d="M10 64 C10 51 19 45 32 45 C45 45 54 51 54 64 Z" className={clothes} />
      <rect x="28" y="36" width="8" height="10" rx="2" className="fill-skin-shade" />
      <ellipse cx="32" cy="27" rx="11" ry="12.5" className="fill-skin" />
      {gender === 'female' ? <FemaleHair layer="front" /> : <MaleHair />}
      <Eyes />
      <Smile />
      {role === 'agent' ? <Headset /> : null}
    </svg>
  );
}

/** A face in a circle: thin light-brown border, gold ring while speaking, "AI" tag on the agent. */
export function Avatar({
  name,
  gender,
  role,
  speaking = false,
  size = 'md',
  pulsing = false,
}: AvatarProps): React.JSX.Element {
  const ring = speaking ? 'ring-4 ring-gold shadow-md' : 'ring-1 ring-border';
  return (
    <div
      data-testid={`avatar-${role}`}
      data-speaking={speaking ? 'yes' : 'no'}
      className={`relative shrink-0 ${SIZES[size]}`}
    >
      <div
        role="img"
        aria-label={role === 'agent' ? `${name}, AI assistant` : name}
        className={`h-full w-full overflow-hidden rounded-full transition-shadow ${ring} ${
          pulsing ? 'animate-dial' : ''
        }`}
      >
        <Face gender={gender} role={role} />
      </div>
      {role === 'agent' ? (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-on-brand ring-1 ring-gold">
          AI
        </span>
      ) : null}
    </div>
  );
}
