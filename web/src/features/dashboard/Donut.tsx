// web/src/features/dashboard/Donut.tsx
// This month's credit as a ring chart (SPEC §12): collected / not yet due / overdue, in the same
// colours as the WhatsApp chart and its 🟩 🟦 🟧 caption (palette checked for colour-blind
// separation; kept on the beige theme to match WhatsApp, Saim's M7 B2 Decision 3 (a)). A small
// surface-coloured gap separates the segments;
// each segment has a hover tooltip; the legend names every part with its amount and share, so
// nothing depends on colour alone.
import { formatInr } from './format.ts';

export interface DonutPart {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly colour: string;
}

export const PART_COLOURS = {
  collected: '#2E9E5B',
  notYetDue: '#3B82F6',
  overdue: '#E8590C',
} as const;

const SIZE = 180;
const RADIUS = 70;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Gap between segments, in pixels along the ring. */
const GAP = 2;

interface Segment extends DonutPart {
  readonly length: number;
  readonly offset: number;
  readonly share: number;
}

export function segmentsOf(parts: readonly DonutPart[]): readonly Segment[] {
  const shown = parts.filter((part) => part.value > 0);
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  if (total === 0) return [];
  const gap = shown.length > 1 ? GAP : 0;
  let start = 0;
  return shown.map(function place(part): Segment {
    const share = part.value / total;
    const segment = {
      ...part,
      share,
      length: Math.max(0, share * CIRCUMFERENCE - gap),
      offset: -start,
    };
    start += share * CIRCUMFERENCE;
    return segment;
  });
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function Arc({ segment }: { readonly segment: Segment }): React.JSX.Element {
  return (
    <circle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke={segment.colour}
      strokeWidth={STROKE}
      strokeDasharray={`${segment.length} ${CIRCUMFERENCE}`}
      strokeDashoffset={segment.offset}
      className="transition-opacity hover:opacity-80"
    >
      <title>{`${segment.label}: ${formatInr(segment.value)} (${percent(segment.share)})`}</title>
    </circle>
  );
}

function Ring({
  segments,
  centre,
}: {
  readonly segments: readonly Segment[];
  readonly centre: string;
}): React.JSX.Element {
  const label = segments.map((s) => `${s.label} ${formatInr(s.value)}`).join(', ');
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-44 w-44 shrink-0"
      role="img"
      aria-label={`This month: ${label}`}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={STROKE}
      />
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
        {segments.map((segment) => (
          <Arc key={segment.key} segment={segment} />
        ))}
      </g>
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-ink text-2xl font-semibold"
      >
        {centre}
      </text>
    </svg>
  );
}

function Legend({ parts }: { readonly parts: readonly DonutPart[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-2 text-sm" aria-label="Legend">
      {parts.map((part) => (
        <li key={part.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: part.colour }}
          />
          <span className="text-ink-muted">{part.label}</span>
          <span className="font-semibold">{formatInr(part.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Donut({
  parts,
  centre,
}: {
  readonly parts: readonly DonutPart[];
  readonly centre: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <Ring segments={segmentsOf(parts)} centre={centre} />
      <Legend parts={parts} />
    </div>
  );
}
