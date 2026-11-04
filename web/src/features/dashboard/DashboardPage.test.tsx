// web/src/features/dashboard/DashboardPage.test.tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeDashboard } from '../../test/dashboardFakes.ts';
import { fakeApi } from '../../test/fakes.ts';
import { DashboardPage, weekNote } from './DashboardPage.tsx';
import { segmentsOf } from './Donut.tsx';

describe('DashboardPage', () => {
  it('shows the KPIs, the month chart with its legend, the top 5 and recent calls', async () => {
    render(<DashboardPage api={fakeApi().api} dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('30%', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('▲ 6 points vs last week')).toBeInTheDocument();
    expect(screen.getByText('₹1,84,000')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Not yet due')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Collected ₹30,000/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ramesh' })).toHaveAttribute(
      'href',
      '/shopkeepers?id=b0000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByText('Risky 42')).toBeInTheDocument();
    expect(screen.getByText('simulated')).toBeInTheDocument();
    expect(screen.getByText('≈ ₹1')).toBeInTheDocument();
  });

  it('switches English under Telugu off and on', async () => {
    const fake = fakeDashboard();
    render(<DashboardPage api={fakeApi().api} dashboard={fake.dashboard} />);
    const box = await screen.findByRole('checkbox', { name: /English under every Telugu/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(function settled() {
      expect(box).not.toBeChecked();
    });
    expect(fake.requests).toContain('english:false');
  });

  it('without a valid link, asks to open it from WhatsApp (and the demo controls stay)', async () => {
    const fake = fakeDashboard();
    fake.needsLink = true;
    render(<DashboardPage api={fakeApi().api} dashboard={fake.dashboard} />);
    expect(await screen.findByText('Open the dashboard from WhatsApp')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ring Ramesh' })).toBeInTheDocument();
  });
});

describe('dashboard helpers', () => {
  it('week change wording', () => {
    expect(weekNote(null)).toBeUndefined();
    expect(weekNote(0)).toBe('Same as last week');
    expect(weekNote(-3)).toBe('▼ 3 points vs last week');
  });

  it('ring segments: zero parts skipped, a gap between parts, none for a single part', () => {
    const two = segmentsOf([
      { key: 'a', label: 'A', value: 1, colour: '#000' },
      { key: 'b', label: 'B', value: 0, colour: '#111' },
      { key: 'c', label: 'C', value: 1, colour: '#222' },
    ]);
    expect(two.map((s) => s.key)).toEqual(['a', 'c']);
    expect(two[0]?.length).toBeCloseTo(Math.PI * 70 - 2);
    expect(two[1]?.offset).toBeCloseTo(-Math.PI * 70);
    const one = segmentsOf([{ key: 'a', label: 'A', value: 5, colour: '#000' }]);
    expect(one[0]?.length).toBeCloseTo(2 * Math.PI * 70);
    expect(segmentsOf([])).toEqual([]);
  });
});
