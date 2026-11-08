// web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App, routeOf } from './App.tsx';
import { NO_LINK_MESSAGE } from './features/munshi/munshiState.ts';
import { LINK_TOKEN } from './test/fixtures.ts';
import { fakeApi, fakeVoice } from './test/fakes.ts';
import { fakeDashboard } from './test/dashboardFakes.ts';

function renderAt(path: string, search = '', hash = ''): void {
  render(
    <App
      api={fakeApi().api}
      dashboard={fakeDashboard().dashboard}
      voice={fakeVoice().client}
      path={path}
      search={search}
      hash={hash}
    />,
  );
}

describe('App', () => {
  it('renders the dashboard with the demo controls on /', async () => {
    renderAt('/');
    expect(screen.getByText('Easy Recovery AI')).toBeInTheDocument();
    expect(await screen.findByText('Collected this month')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ring Ramesh' })).toBeInTheDocument();
  });

  it('renders the shopkeepers list, and one shopkeeper with ?id=', async () => {
    renderAt('/shopkeepers');
    expect(await screen.findByText('Shopkeepers (2)')).toBeInTheDocument();
  });

  it('renders one call on /calls?id=', async () => {
    renderAt('/calls', '?id=c1');
    expect(await screen.findByRole('heading', { name: 'Call with Ramesh' })).toBeInTheDocument();
  });

  it('renders the phone page on /phone', async () => {
    renderAt('/phone/');
    expect(await screen.findByRole('heading', { name: 'Waiting for a call…' })).toBeInTheDocument();
  });

  it('renders the Munshi page on /munshi with the link token from the hash (M8)', async () => {
    renderAt('/munshi/', '', `#t=${LINK_TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Start call' })).toBeInTheDocument();
  });

  it('on /munshi without a valid token, says to use the WhatsApp link', async () => {
    renderAt('/munshi', '', '#t=not-a-token');
    expect(await screen.findByText(NO_LINK_MESSAGE)).toBeInTheDocument();
  });

  it('routeOf drops trailing slashes', () => {
    expect([routeOf('/munshi/'), routeOf('/'), routeOf('')]).toEqual(['/munshi', '/', '/']);
  });
});
