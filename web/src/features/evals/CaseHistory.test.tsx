// web/src/features/evals/CaseHistory.test.tsx
// "How it got fixed" (2026-11-22): each case across runs, what changed before each run, a cell
// opening that run's conversation, and before / after for a case that was fixed.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { fakeDashboard } from '../../test/dashboardFakes.ts';
import { EvalsPage } from './EvalsPage.tsx';

describe('How it got fixed', () => {
  it('shows every run with what changed, and every case across the runs', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('How it got fixed')).toBeInTheDocument();
    expect(screen.getByText('Prompt changed')).toBeInTheDocument();
    expect(screen.getByText('Prompt v7: read a promise back in a full sentence.')).toBeVisible();
    expect(screen.getByText(/1 case\(s\) failed before and pass now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asha-02 failed on/ })).toHaveTextContent('✗');
  });

  it('a cell opens that run’s conversation', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(await screen.findByRole('button', { name: /asha-02 failed on/ }));
    expect(await screen.findByText('assistant: OK, bye')).toBeInTheDocument();
  });

  it('before / after shows the failing and the passing conversation with what changed', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixed · before / after' }));
    const compare = await screen.findByRole('region', { name: 'Before and after: asha-02' });
    expect(within(compare).getByText(/What changed \(Prompt changed\)/)).toBeInTheDocument();
    expect(await within(compare).findByText('assistant: OK, bye')).toBeInTheDocument();
    expect(await within(compare).findByText('assistant: So 2,000 by Monday?')).toBeInTheDocument();
    expect(within(compare).getByText(/Reads the promise back: Not read back/)).toBeInTheDocument();
  });
});
