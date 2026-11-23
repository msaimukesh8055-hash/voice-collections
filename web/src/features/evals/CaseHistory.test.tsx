// web/src/features/evals/CaseHistory.test.tsx
// The prompt-version table (2026-11-22, folded in 2026-11-23): each case across runs with each
// run's prompt version and what changed, a cell opening that run's conversation, and before /
// after (with the fix note, prompt lines and the run's note) for a case that was fixed.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EVALS, fakeDashboard } from '../../test/dashboardFakes.ts';
import { brokeThenFixed, storyOf } from './CaseHistory.tsx';
import { EvalsPage } from './EvalsPage.tsx';

describe('Test results by prompt version', () => {
  it('shows every run with what changed, and every case across the runs', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    expect(await screen.findByText('Test results by prompt version')).toBeInTheDocument();
    expect(screen.queryByText('How it got fixed')).toBeNull();
    expect(screen.getByText('Prompt changed')).toBeInTheDocument();
    // The run's note now lives in the before / after panel only.
    expect(screen.queryByText('Prompt v7: read a promise back in a full sentence.')).toBeNull();
    expect(screen.getByText(/1 case\(s\) failed before and pass now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asha-02 failed on/ })).toHaveTextContent('✗');
    expect(screen.getAllByText('prompt v7')[0]).toBeInTheDocument();
    expect(screen.queryByText(/Sarvam v/)).toBeNull();
  });

  it('a case that passed, broke and was fixed again says so', () => {
    const runs = EVALS.targets[0]?.caseHistory.runs ?? [];
    const base = runs[1];
    if (!base) throw new Error('fake history needs two runs');
    const third = { ...base, id: 'run-3', promptName: 'v8' };
    const all = [...runs, third];
    const story = {
      scenarioId: 'asha-09',
      name: 'Prompt injection',
      results: { 'run-asha-1': true, 'run-asha-2': false, 'run-3': true },
      fixedIn: 'run-3',
      lastFailedIn: 'run-asha-2',
      fixNote: null,
    };
    expect(storyOf(all, story)).toBe('✓ prompt v6 → ✗ prompt v7 → ✓ prompt v8');
    expect(brokeThenFixed(all, story)).toBe(true);
    expect(
      brokeThenFixed(runs, {
        ...story,
        results: { 'run-asha-1': false, 'run-asha-2': true },
        fixedIn: 'run-asha-2',
        lastFailedIn: 'run-asha-1',
      }),
    ).toBe(false);
  });

  it('a cell opens that run’s conversation', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(await screen.findByRole('button', { name: /asha-02 failed on/ }));
    expect(await screen.findByText('OK, bye')).toBeInTheDocument();
  });

  it('before / after shows the failing and the passing conversation with what changed', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixed · before / after' }));
    const compare = await screen.findByRole('region', { name: 'Before and after: asha-02' });
    expect(within(compare).getByText('✗ prompt v6 → ✓ prompt v7')).toBeInTheDocument();
    expect(
      within(compare).getByText(/Failed on prompt v6, fixed on prompt v7/),
    ).toBeInTheDocument();
    expect(within(compare).getByText(/Everything else in that run/)).toBeInTheDocument();
    expect(
      within(compare).getByText(/reads the promise back in a full sentence/),
    ).toBeInTheDocument();
    expect(within(compare).getByText(/1 added, 1 taken out/)).toBeInTheDocument();
    expect(
      within(compare).getByText('+ Read the promise back in a full sentence.'),
    ).toBeInTheDocument();
    expect(await within(compare).findByText('OK, bye')).toBeInTheDocument();
    expect(await within(compare).findByText('So 2,000 by Monday?')).toBeInTheDocument();
    expect(within(compare).getByText(/Reads the promise back: Not read back/)).toBeInTheDocument();
  });
});
