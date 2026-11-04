// web/src/features/shopkeepers/ShopkeepersPage.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { fakeDashboard, RAMESH } from '../../test/dashboardFakes.ts';
import { ShopkeepersPage } from './ShopkeepersPage.tsx';
import { matches } from './ShopkeeperList.tsx';

describe('ShopkeepersPage', () => {
  it('lists shopkeepers and filters by name, shop or area', async () => {
    render(<ShopkeepersPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(await screen.findByRole('link', { name: 'Latha' })).toBeInTheDocument();
    const search = screen.getByPlaceholderText(/Search/);
    fireEvent.change(search, { target: { value: 'old town' } });
    expect(screen.queryByRole('link', { name: 'Latha' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ramesh' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No match.')).toBeInTheDocument();
  });

  it('shows one shopkeeper: dues, score parts, entries, promises, notes, calls', async () => {
    const fake = fakeDashboard();
    render(<ShopkeepersPage dashboard={fake.dashboard} id={RAMESH.id} />);
    expect(await screen.findByRole('heading', { name: 'Ramesh' })).toBeInTheDocument();
    expect(fake.requests).toEqual([`shopkeeper:${RAMESH.id}`]);
    expect(
      screen.getByText('₹5,000 overdue for 12 days · next ₹3,500 on 21 Nov'),
    ).toBeInTheDocument();
    expect(screen.getByText('20/40')).toBeInTheDocument();
    expect(screen.getByText('broken')).toBeInTheDocument();
    expect(screen.getByText('Busy shop; promised Monday.')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
  });

  it('search matching ignores case and spaces', () => {
    expect(matches('  ', { name: 'A', shopName: 'B', area: 'C' })).toBe(true);
    expect(matches('KIRANA', { name: 'Ramesh', shopName: 'Ramesh Kirana', area: 'x' })).toBe(true);
  });
});
