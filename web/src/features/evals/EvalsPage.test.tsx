// web/src/features/evals/EvalsPage.test.tsx
import { render, screen, within } from '@testing-library/react';
import { EVALS, fakeDashboard } from '../../test/dashboardFakes.ts';
import { EvalsPage } from './EvalsPage.tsx';

function card(title: RegExp): HTMLElement {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  if (!section) throw new Error(`No card ${String(title)}`);
  return section;
}

describe('EvalsPage', () => {
  it('shows the gate, the counts and the version for each thing tested', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    await screen.findByRole('heading', { name: /Asha/ });
    const asha = within(card(/Asha/));
    expect(asha.getByText('Release gate failed')).toBeInTheDocument();
    expect(asha.getByText('16 of 18 behaviours passed (need 90%)')).toBeInTheDocument();
    expect(
      asha.getByText(
        '6 of 9 cases passed · 16 of 18 behaviours · 0 guardrail failures · 0 critical check failures',
      ),
    ).toBeInTheDocument();
    expect(asha.getByText(/prompt v6 · agent version 6 · prompt hash abc123/)).toBeInTheDocument();
    const brain = within(card(/WhatsApp brain/));
    expect(brain.getByText('Release gate passed')).toBeInTheDocument();
    expect(brain.getByText('21 of 21 cases passed · 0 money cases wrong')).toBeInTheDocument();
  });

  it('lists the latest run case by case, with the reason for each failure and the conversation', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    const row = (await screen.findByText('asha-08')).closest('tr');
    expect(row).toHaveTextContent('Angry, asks to stop calling');
    expect(row).toHaveTextContent('Fail');
    expect(row).toHaveTextContent('Hands over to the owner: The agent did not offer a callback.');
    expect(row).toHaveTextContent('must_call: not called: request_owner_callback');
    expect(row).toHaveTextContent('assistant: Namaste');
    expect(screen.getByText('asha-01').closest('tr')).toHaveTextContent('Pass');
  });

  it('shows the recent runs as a trend, newest first', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    await screen.findByRole('heading', { name: /Asha/ });
    const trend = within(card(/Asha/)).getByRole('list', { name: 'Recent runs' });
    const runs = within(trend).getAllByRole('listitem');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveTextContent('6/9 · failed');
    expect(runs[1]).toHaveTextContent('2/2 · passed');
  });

  it('says how to run evals when nothing is stored yet', async () => {
    const fake = fakeDashboard();
    fake.evals = { ...EVALS, targets: [] };
    render(<EvalsPage dashboard={fake.dashboard} />);
    expect(await screen.findByText(/No eval run is stored yet/)).toBeInTheDocument();
  });

  it('asks for the WhatsApp link when there is none', async () => {
    const fake = fakeDashboard();
    fake.needsLink = true;
    render(<EvalsPage dashboard={fake.dashboard} />);
    expect(await screen.findByText('Open the dashboard from WhatsApp')).toBeInTheDocument();
  });
});
