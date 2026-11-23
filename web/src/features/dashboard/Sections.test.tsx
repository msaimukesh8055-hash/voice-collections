// web/src/features/dashboard/Sections.test.tsx
// The section menu (2026-11-23): the first section starts open; a #hash on load opens that one
// instead (a link like /evals#munshi); a card in a section of the same name drops its own title.
import { render, screen } from '@testing-library/react';
import { Card } from './Layout.tsx';
import { type PageSection, Sections } from './Sections.tsx';

const SECTIONS: readonly PageSection[] = [
  { id: 'asha', title: 'Asha', content: <Card title="Asha">Asha's cases</Card> },
  { id: 'munshi', title: 'Munshi', badge: '⚠ 2', content: <Card title="Other">Munshi's</Card> },
];

describe('Sections', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens the first section; the rest start closed', () => {
    render(<Sections sections={SECTIONS} />);
    expect(document.getElementById('asha')).toHaveAttribute('open');
    expect(document.getElementById('munshi')).not.toHaveAttribute('open');
  });

  it('opens the section named in the address instead', () => {
    window.history.replaceState(null, '', '/evals#munshi');
    render(<Sections sections={SECTIONS} />);
    expect(document.getElementById('munshi')).toHaveAttribute('open');
    expect(document.getElementById('asha')).not.toHaveAttribute('open');
  });

  it('lists every section twice (side menu, phone row) with its badge', () => {
    render(<Sections sections={SECTIONS} />);
    expect(screen.getAllByRole('navigation', { name: 'Sections' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /^Munshi\s*⚠ 2$/ })).toHaveLength(2);
  });

  it('a card does not repeat its section title; a different title stays', () => {
    render(<Sections sections={SECTIONS} />);
    expect(screen.getAllByRole('heading', { name: 'Asha' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument();
  });
});
