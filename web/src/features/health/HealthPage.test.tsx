// web/src/features/health/HealthPage.test.tsx
import { render, screen } from '@testing-library/react';
import { fakeDashboard, HEALTH } from '../../test/dashboardFakes.ts';
import { OpsPage } from '../ops/OpsPage.tsx';
import { hasEnoughTrend, HealthPage, TREND_MIN_DAYS } from './HealthPage.tsx';

describe('HealthPage', () => {
  it('shows each agent: verdicts, guardrail fails, cost, top problems linking to their calls', async () => {
    const fake = fakeDashboard();
    render(<HealthPage dashboard={fake.dashboard} />);
    expect(
      await screen.findByRole('heading', { name: /^Asha · calls shopkeepers/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Last 4 calls')).toBeInTheDocument();
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
      await screen.findByRole('heading', { name: /^WhatsApp bot · the owner’s chat/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Last 3 messages')).toBeInTheDocument();
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

  it('a top line says what needs a look across the agents (2026-11-23)', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(
      await screen.findByText(
        '⚠ Asha: 1 with a guardrail fail · Asha: 1 tool over 1 s · WhatsApp replies slow (8.7 s, target 5 s)',
      ),
    ).toBeInTheDocument();
  });

  it('each voice agent lists its tools against the 1 s target; WhatsApp shows 95% within', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('1400 ms · over')).toBeInTheDocument();
    expect(screen.getByText('300 ms ✓')).toBeInTheDocument();
    expect(screen.getByText('95% answered within')).toBeInTheDocument();
    expect(screen.getByText('8.7 s')).toBeInTheDocument();
    expect(screen.getByText('target 5 s')).toBeInTheDocument();
  });

  it('the Ops page no longer has an agent quality strip (Ops is the shared machine only)', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(await screen.findByRole('heading', { name: /^Now/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agent quality/ })).toBeNull();
  });

  it('keeps problems and prompt versions, hides the 14-day trend while calls span few days', async () => {
    render(<HealthPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('Live calls by prompt version')).toBeInTheDocument();
    expect(screen.queryByText('Last 14 days')).toBeNull();
    expect(screen.queryByLabelText('Calls per day, last 14 days')).toBeNull();
  });

  it('the trend shows once calls fall on 7 of the last 14 days', () => {
    const [asha] = HEALTH.agents;
    if (!asha) throw new Error('needs Asha');
    const day = (n: number): (typeof asha.trend)[number] => ({
      date: `2026-11-${String(n).padStart(2, '0')}`,
      good: n % 2,
      check: 1 - (n % 2),
      failed: 0,
    });
    const quietDay = { date: '2026-11-01', good: 0, check: 0, failed: 0 };
    const six = { ...asha, trend: [quietDay, ...[1, 2, 3, 4, 5, 6].map(day)] };
    const seven = { ...asha, trend: [...six.trend, day(7)] };
    expect(TREND_MIN_DAYS).toBe(7);
    expect(hasEnoughTrend(six)).toBe(false);
    expect(hasEnoughTrend(seven)).toBe(true);
  });
});
