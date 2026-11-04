// web/src/features/dashboard/Layout.tsx
// The dashboard's frame (M6, SPEC §12): title, navigation between the three pages, and the
// shared loading / error / "open from WhatsApp" states. One light theme (light-blue canvas).
import type { ReactNode } from 'react';
import type { Loaded } from './useLoad.ts';

export const PAGES = [
  { path: '/', label: 'Dashboard' },
  { path: '/shopkeepers', label: 'Shopkeepers' },
  { path: '/calls', label: 'Calls' },
] as const;

interface LayoutProps {
  readonly current: string;
  readonly children: ReactNode;
}

export function Layout({ current, children }: LayoutProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand">
              Sri Lakshmi Traders · Anantapur
            </p>
            <p className="text-lg font-semibold">Easy Recovery AI</p>
          </div>
          <nav aria-label="Pages" className="flex gap-1">
            {PAGES.map((page) => (
              <a
                key={page.path}
                href={page.path}
                aria-current={page.path === current ? 'page' : undefined}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-soft aria-[current=page]:bg-brand aria-[current=page]:text-white"
              >
                {page.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">{children}</main>
    </div>
  );
}

export function Card({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
      {title ? <h2 className="mb-3 text-base font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Loading, error and missing-link states; `children` runs only when the data is ready. */
export function LoadState<T>({
  state,
  children,
}: {
  readonly state: Loaded<T>;
  readonly children: (data: T) => ReactNode;
}): React.JSX.Element {
  if (state.kind === 'loading') {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }
  if (state.kind === 'needsLink') {
    return (
      <Card title="Open the dashboard from WhatsApp">
        <p className="text-sm text-ink-muted">
          For privacy, this page only opens from the link the bot sends. Send{' '}
          <span className="font-semibold text-ink">dashboard</span> to the bot on WhatsApp and tap
          the link. Links work for 24 hours.
        </p>
      </Card>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.message}
      </p>
    );
  }
  return <>{children(state.data)}</>;
}
