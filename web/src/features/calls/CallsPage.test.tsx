// web/src/features/calls/CallsPage.test.tsx
import { render, screen } from '@testing-library/react';
import type { CallDetail } from '../../lib/dashboardApi.ts';
import { CALL, fakeDashboard, TRACE } from '../../test/dashboardFakes.ts';
import { CallsPage } from './CallsPage.tsx';

describe('CallsPage', () => {
  it('lists calls with a link to each', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: /Nov/ });
    expect(link).toHaveAttribute('href', `/calls?id=${CALL.id}`);
    expect(screen.getByText('₹12.39')).toBeInTheDocument();
  });

  it('shows one call: facts, follow-up decision, summary, transcript and tool calls', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call with Ramesh' })).toBeInTheDocument();
    expect(screen.getByText('check promise')).toBeInTheDocument();
    expect(screen.getByText(/Promised to pay/)).toBeInTheDocument();
    expect(screen.getByText('Monday I will pay.')).toBeInTheDocument();
    expect(screen.getByText('get_dues · 120 ms')).toBeInTheDocument();
    expect(screen.getByText('I will give on Monday.')).toBeInTheDocument();
    expect(screen.getByText('Telugu')).toBeInTheDocument();
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
  });

  it('shows the call scorecard (verdict, groups, values, gaps) and the call step by step', async () => {
    const scored: CallDetail = {
      ...CALL,
      scorecard: {
        verdict: 'failed',
        passed: 18,
        applicable: 21,
        groups: [
          {
            name: 'Guardrails',
            checks: [
              {
                id: 'identity_first',
                label: 'Identity confirmed before any amount',
                status: 'fail',
                value: 'dues before identity',
              },
            ],
          },
          {
            name: 'Latency',
            checks: [
              {
                id: 'reply_p50',
                label: 'Asha reply time, typical',
                status: 'pass',
                value: '1.1 s over 12 replies',
              },
              {
                id: 'reply_max',
                label: 'Asha reply time, slowest',
                status: 'na',
                value: 'not measured for this call',
              },
            ],
          },
        ],
        gaps: ['Tone and empathy are not judged yet.'],
      },
      trace: TRACE.steps,
    };
    const fake = fakeDashboard();
    const dashboard = { ...fake.dashboard, call: () => Promise.resolve(scored) };
    render(<CallsPage dashboard={dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call scorecard' })).toBeInTheDocument();
    expect(screen.getByText('❌ A guardrail failed')).toBeInTheDocument();
    expect(screen.getByText(/18 of 21 checks passed/)).toBeInTheDocument();
    expect(screen.getByText('dues before identity')).toBeInTheDocument();
    expect(screen.getByText('1.1 s over 12 replies')).toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.getByText('Tone and empathy are not judged yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This call, step by step' })).toBeInTheDocument();
  });

  it('an older call without a scorecard or steps still shows the rest', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call with Ramesh' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Call scorecard' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'This call, step by step' }),
    ).not.toBeInTheDocument();
  });
});
