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
    expect(screen.getByRole('link', { name: '1 need a look' })).toHaveAttribute(
      'href',
      '/calls?ids=c2&label=Need+a+look',
    );
    expect(screen.getByRole('link', { name: '2 went well' })).toHaveAttribute(
      'href',
      '/calls?ids=c3%2Cc4&label=Went+well',
    );
    expect(screen.getByText('Why 2 calls need a look')).toBeInTheDocument();
    expect(screen.getByText('₹16.50')).toBeInTheDocument();
    expect(screen.getByText('Identity confirmed before dues')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1 call' })).toHaveAttribute(
      'href',
      '/calls?ids=c0000000-0000-4000-8000-000000000001&label=Identity+confirmed+before+dues',
    );
    expect(screen.getByRole('link', { name: '2 calls' })).toHaveAttribute(
      'href',
      expect.stringContaining('/calls?ids=c1%2Cc2&label='),
    );
    expect(screen.getByText('v7')).toBeInTheDocument();
    expect(screen.getByText('4.5/5')).toBeInTheDocument();
  });

  it('an agent with no calls says so; unscored calls are mentioned; links back to Ops', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('No finished calls yet.')).toBeInTheDocument();
    expect(screen.getByText(/2 older call\(s\) not scored yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ops' })[0]).toHaveAttribute('href', '/ops');
  });

  it('the WhatsApp bot card counts messages and opens the WhatsApp page', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(
      await screen.findByText('WhatsApp bot · the owner’s chat · last 3 messages'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '2 need a look' })).toHaveAttribute(
      'href',
      '/whatsapp?ids=e2%2Ce3&label=Need+a+look',
    );
    expect(screen.getByText('Why 2 messages need a look')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1 message' })).toHaveAttribute(
      'href',
      '/whatsapp?ids=e2&label=Card+answered',
    );
    expect(screen.getByText('Cost per message')).toBeInTheDocument();
  });

  it('the Ops page has an Agent quality tile that opens this page', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(
      await screen.findByText('Asha 2/4 went well · Munshi 0/0 went well · WhatsApp 1/3 went well'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agent quality/ })).toHaveAttribute('href', '/health');
  });
});
