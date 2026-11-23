// web/src/features/dashboard/Sections.tsx
// Section menu (Saim, 2026-11-23): the long pages (Evals, Ops, Agent health, an Asha or Munshi
// call, a WhatsApp message) are split into folding sections with a menu of them: on the left,
// sticky, on a wide screen; a row of buttons on top on a phone. Clicking one opens that section
// and scrolls to it; the address gets #<section> so a link like /evals#munshi opens it directly.
// The first section starts open, the others closed. A section's single card does not repeat the
// section's title (SectionTitle context, read by Card).
import {
  createContext,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

export interface PageSection {
  /** The #hash; lowercase words and dashes. */
  readonly id: string;
  readonly title: string;
  /** A short word after the title in the menu, e.g. "⚠ 2". */
  readonly badge?: string | null;
  readonly content: ReactNode;
}

/** The title of the section a card sits in; Card leaves out its own title when it is the same. */
export const SectionTitle = createContext<string | null>(null);

export function useSectionTitle(): string | null {
  return useContext(SectionTitle);
}

function hashId(): string {
  return typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.slice(1));
}

function scrollToSection(id: string): void {
  const element = document.getElementById(id);
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function useOpenSections(sections: readonly PageSection[]): {
  readonly open: ReadonlySet<string>;
  readonly current: string | null;
  readonly show: (id: string) => void;
  readonly setOne: (id: string, isOpen: boolean) => void;
} {
  const known = sections.map((section) => section.id).join(',');
  const first = sections[0]?.id ?? null;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const wanted = hashId();
    const ids = known.split(',');
    return new Set([ids.includes(wanted) ? wanted : (first ?? '')]);
  });
  const [current, setCurrent] = useState<string | null>(() => {
    const wanted = hashId();
    return known.split(',').includes(wanted) ? wanted : first;
  });
  const show = useCallback(function show(id: string): void {
    setOpen(function add(before) {
      return new Set([...before, id]);
    });
    setCurrent(id);
    window.requestAnimationFrame(function scrollLater() {
      scrollToSection(id);
    });
  }, []);
  const setOne = useCallback(function setOne(id: string, isOpen: boolean): void {
    setOpen(function change(before) {
      if (before.has(id) === isOpen) return before;
      const next = new Set(before);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  useHashSections(known, show);
  return { open, current, show, setOne };
}

/** Opens a section when the page loads with its #hash, and when the hash changes later. */
function useHashSections(known: string, show: (id: string) => void): void {
  useEffect(
    function followHash() {
      const ids = known.split(',');
      function onHashChange(): void {
        const wanted = hashId();
        if (ids.includes(wanted)) show(wanted);
      }
      if (ids.includes(hashId())) {
        window.requestAnimationFrame(function scrollOnLoad() {
          scrollToSection(hashId());
        });
      }
      window.addEventListener('hashchange', onHashChange);
      return function stop() {
        window.removeEventListener('hashchange', onHashChange);
      };
    },
    [known, show],
  );
}

const MENU_LINK =
  'block rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-brand-soft aria-[current=true]:bg-brand-soft aria-[current=true]:font-semibold aria-[current=true]:text-brand focus-visible:outline-2 focus-visible:outline-brand';
const MOBILE_LINK =
  'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm text-ink-muted ring-1 ring-border bg-surface aria-[current=true]:bg-brand aria-[current=true]:text-on-brand';

function MenuLink({
  section,
  current,
  onShow,
  className,
}: {
  readonly section: PageSection;
  readonly current: boolean;
  readonly onShow: (id: string) => void;
  readonly className: string;
}): React.JSX.Element {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    window.history.replaceState(null, '', `#${encodeURIComponent(section.id)}`);
    onShow(section.id);
  }
  return (
    <a href={`#${section.id}`} aria-current={current} onClick={handleClick} className={className}>
      {section.title}
      {section.badge ? <span className="ml-1 text-xs">{section.badge}</span> : null}
    </a>
  );
}

function Menu({
  sections,
  current,
  onShow,
}: {
  readonly sections: readonly PageSection[];
  readonly current: string | null;
  readonly onShow: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      <nav
        aria-label="Sections"
        className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-canvas/95 px-4 py-2 md:hidden"
      >
        {sections.map((section) => (
          <MenuLink
            key={section.id}
            section={section}
            current={section.id === current}
            onShow={onShow}
            className={MOBILE_LINK}
          />
        ))}
      </nav>
      <nav aria-label="Sections" className="hidden md:sticky md:top-4 md:block md:self-start">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-brand">
          On this page
        </p>
        {sections.map((section) => (
          <MenuLink
            key={section.id}
            section={section}
            current={section.id === current}
            onShow={onShow}
            className={MENU_LINK}
          />
        ))}
      </nav>
    </>
  );
}

function Section({
  section,
  open,
  onToggle,
}: {
  readonly section: PageSection;
  readonly open: boolean;
  readonly onToggle: (id: string, isOpen: boolean) => void;
}): React.JSX.Element {
  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>): void {
    onToggle(section.id, event.currentTarget.open);
  }
  return (
    <details id={section.id} open={open} onToggle={handleToggle} className="group scroll-mt-16">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl bg-surface/95 px-5 py-3 text-base font-semibold shadow-sm ring-1 ring-border hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand">
        <h2 className="text-base font-semibold">
          {section.title}
          {section.badge ? <span className="ml-2 text-sm">{section.badge}</span> : null}
        </h2>
        <span aria-hidden="true" className="text-brand transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-5">
        <SectionTitle.Provider value={section.title}>{section.content}</SectionTitle.Provider>
      </div>
    </details>
  );
}

/** The page's sections with their menu; `top` (facts, a status line) stays above, unfolded. */
export function Sections({
  sections,
  top,
}: {
  readonly sections: readonly PageSection[];
  readonly top?: ReactNode;
}): React.JSX.Element {
  const { open, current, show, setOne } = useOpenSections(sections);
  return (
    <div className="flex flex-col gap-5 md:grid md:grid-cols-[11rem_1fr] md:items-start md:gap-6">
      <Menu sections={sections} current={current} onShow={show} />
      <div className="flex min-w-0 flex-col gap-4">
        {top}
        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            open={open.has(section.id)}
            onToggle={setOne}
          />
        ))}
      </div>
    </div>
  );
}
