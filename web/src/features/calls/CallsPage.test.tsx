// web/src/features/calls/CallsPage.test.tsx
import { render, screen } from '@testing-library/react';
import { CALL, fakeDashboard } from '../../test/dashboardFakes.ts';
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
});
