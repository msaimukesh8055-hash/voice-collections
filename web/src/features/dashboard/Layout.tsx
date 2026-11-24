// web/src/features/dashboard/Layout.tsx
// The dashboard's frame (M6, SPEC §12): title, navigation (the shop's pages, then the "Agent ops"
// section: Asha calls, Munshi calls, WhatsApp chats, Agent health, Ops, Evals), and the shared loading / error /
// "open from WhatsApp" states. One light theme (very light blue; see CLAUDE.md). Full laptop width
// (Saim, 2026-11-24), up to 100rem on a big monitor; a card's own paragraphs stay readable-width.
import { type ReactNode, useEffect, useState } from 'react';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import { useSectionTitle } from './Sections.tsx';
import type { Loaded } from './useLoad.ts';

/** The shop's own pages. */
const BUSINESS_PAGES = [
  { path: '/', label: 'Dashboard' },
  { path: '/shopkeepers', label: 'Shopkeepers' },
] as const;

/** How the agents are doing, grouped as one section (Saim, 2026-11-20). */
const AGENT_OPS_PAGES = [
  { path: '/calls', label: 'Asha calls' },
  { path: '/munshi-calls', label: 'Munshi calls' },
  { path: '/whatsapp', label: 'WhatsApp chats' },
  { path: '/health', label: 'Agent health' },
  { path: '/ops', label: 'Ops' },
  { path: '/evals', label: 'Evals' },
] as const;

const LINK =
  'rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-soft aria-[current=page]:bg-brand aria-[current=page]:text-on-brand aria-[current=page]:ring-1 aria-[current=page]:ring-gold focus-visible:outline-2 focus-visible:outline-brand';

function PageLinks({
  pages,
  current,
}: {
  readonly pages: readonly { readonly path: string; readonly label: string }[];
  readonly current: string;
}): React.JSX.Element {
  return (
    <>
      {pages.map((page) => (
        <a
          key={page.path}
          href={page.path}
          aria-current={page.path === current ? 'page' : undefined}
          className={LINK}
        >
          {page.label}
        </a>
      ))}
    </>
  );
}

function Navigation({ current }: { readonly current: string }): React.JSX.Element {
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <PageLinks pages={BUSINESS_PAGES} current={current} />
      </div>
      <div
        role="group"
        aria-label="Agent ops"
        className="flex flex-wrap items-center gap-1 rounded-full bg-canvas px-2 py-1 ring-1 ring-border"
      >
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-brand">
          Agent ops
        </span>
        <PageLinks pages={AGENT_OPS_PAGES} current={current} />
      </div>
    </nav>
  );
}

interface LayoutProps {
  readonly current: string;
  readonly dashboard: Pick<DashboardApi, 'localDemo'>;
  readonly children: ReactNode;
}

/** True when this page reads with a localhost dev token (`npm run dev` only). */
function useLocalDemo(dashboard: Pick<DashboardApi, 'localDemo'>): boolean {
  const [local, setLocal] = useState(false);
  useEffect(
    function checkLocalDemo() {
      let active = true;
      dashboard.localDemo().then(function apply(on) {
        if (active) setLocal(on);
      });
      return function cancel() {
        active = false;
      };
    },
    [dashboard],
  );
  return local;
}

/** Visitors who land here directly should know this is the back office (Saim, 2026-11-20). */
function ConsoleNote(): React.JSX.Element {
  return (
    <aside
      aria-label="About this page"
      className="border-b border-note-border bg-note px-4 py-2 text-center text-sm text-ink"
    >
      <strong>This is the operator console, not the product.</strong> Shop owners use Easy Recovery
      AI entirely through WhatsApp and voice calls (Munshi and Asha). This page is where we monitor
      the agents: calls, evals, traces and costs.
    </aside>
  );
}

export function Layout({ current, dashboard, children }: LayoutProps): React.JSX.Element {
  const localDemo = useLocalDemo(dashboard);
  return (
    <div className="min-h-screen text-ink">
      <ConsoleNote />
      <header className="border-b border-gold bg-surface/95">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand">
              Sri Lakshmi Traders · Anantapur
            </p>
            <p className="text-lg font-semibold">Easy Recovery AI</p>
            {localDemo ? (
              <p
                title="Opened on this laptop without the WhatsApp link. The hosted dashboard still needs it."
                className="mt-1 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
              >
                Local demo mode
              </p>
            ) : null}
          </div>
          <Navigation current={current} />
        </div>
      </header>
      <main className="mx-auto flex max-w-[100rem] flex-col gap-5 px-4 py-6 md:px-8">
        {children}
      </main>
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
  // Inside a folding section of the same name, the section's header already says it.
  const sectionTitle = useSectionTitle();
  const shownTitle = title && title !== sectionTitle ? title : null;
  return (
    <section className="rounded-2xl bg-surface/95 p-5 shadow-sm ring-1 ring-border [&>p]:max-w-[90ch]">
      {shownTitle ? <h2 className="mb-3 text-base font-semibold">{shownTitle}</h2> : null}
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
