// web/src/components/Watermark.tsx
// One large, faint logo fixed in the middle of every page, like letterhead (M7 B2, Saim's
// Decision 2 (a)). It sits behind the content (cards are 95% opaque, so it shows through
// faintly), is hidden from screen readers and never takes a click. Its strength is checked
// against text contrast in theme.test.ts (WATERMARK_OPACITY there must match).
export const WATERMARK_SRC = '/brand/logo.svg';

export function Watermark(): React.JSX.Element {
  return (
    <div
      data-testid="watermark"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center"
    >
      <img src={WATERMARK_SRC} alt="" className="w-[min(70vw,560px)] opacity-5 select-none" />
    </div>
  );
}
