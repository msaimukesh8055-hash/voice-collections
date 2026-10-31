// web/src/App.tsx
import { SUPPORTED_LANGUAGES } from '@shared/schemas/customer.ts';

const MILESTONE_LABEL = 'M0 · Foundation';

export function App(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-brand">{MILESTONE_LABEL}</p>
      <h1 className="text-4xl font-semibold">Suvidha Finance — Voice Collections</h1>
      <p className="text-lg text-ink-muted">
        Platform scaffold is ready. The dashboard arrives in M5.
      </p>
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold">Supported languages</h2>
        <ul className="mt-2 flex gap-2">{SUPPORTED_LANGUAGES.map(renderLanguage)}</ul>
      </section>
    </main>
  );
}

function renderLanguage(code: string): React.JSX.Element {
  return (
    <li key={code} className="rounded-md bg-canvas px-3 py-1 text-sm font-medium uppercase">
      {code}
    </li>
  );
}
