// web/src/features/health/HealthPage.test.tsx
import { render, screen } from '@testing-library/react';
import { fakeDashboard } from '../../test/dashboardFakes.ts';
import { OpsPage } from '../ops/OpsPage.tsx';
import { HealthPage } from './HealthPage.tsx';

describe('HealthPage', () => {
  it('shows each agent: verdicts, guardrail fails, cost, top problems linking to their calls', async () => {
    const fake = fakeDashboard();
    render(<HealthPage dashboard={fake.dashboard} />);
    expect(await screen.findByText('Asha · calls shopkeepers · last 4 calls')).toBeInTheDocument();
    expect(fake.requests).toContain('agent-health');
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('✅ 2 · ⚠ 1 · ❌ 1 of 4')).toBeInTheDocument();
    expect(screen.getByText('₹16.50')).toBeInTheDocument();
    expect(screen.getByText('Identity confirmed before dues')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: '#1' });
    expect(links[0]).toHaveAttribute('href', '/calls?id=c0000000-0000-4000-8000-000000000001');
    expect(screen.getByText('v7')).toBeInTheDocument();
    expect(screen.getByText('4.5/5')).toBeInTheDocument();
  });

  it('an agent with no calls says so; unscored calls are mentioned; links back to Ops', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('No finished calls yet.')).toBeInTheDocument();
    expect(screen.getByText(/2 older call\(s\) not scored yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ops' })[0]).toHaveAttribute('href', '/ops');
  });

  it('the Ops page has an Agent quality tile that opens this page', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(
      await screen.findByText('Asha 2/4 went well · Munshi 0/0 went well'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agent quality/ })).toHaveAttribute('href', '/health');
  });
});
