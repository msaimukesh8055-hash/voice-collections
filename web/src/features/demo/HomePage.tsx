// web/src/features/demo/HomePage.tsx
// Home: the demo controls for now. The owner dashboard replaces most of this page in M6.
import type { AppApi } from '../../lib/appApi.ts';
import { DemoControls } from './DemoControls.tsx';

export function HomePage({ api }: { readonly api: AppApi }): React.JSX.Element {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-brand">
          Sri Lakshmi Traders · Anantapur
        </p>
        <h1 className="text-3xl font-semibold">Easy Recovery AI</h1>
        <p className="mt-1 text-ink-muted">
          Asha reminds shopkeepers about udhaar, politely, in Telugu, Hindi or English.
        </p>
      </header>
      <DemoControls api={api} />
    </main>
  );
}
