// web/src/features/evals/EvalsPage.test.tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('lists the latest run case by case with its expected outcome', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    const row = (await screen.findByText('asha-08')).closest('tr');
    expect(row).toHaveTextContent('Angry, asks to stop calling');
    expect(row).toHaveTextContent('Owner call back, nothing logged');
    expect(row).toHaveTextContent('Fail');
    expect(screen.getAllByText('asha-01')[0]?.closest('tr')).toHaveTextContent('Pass');
    expect(screen.queryByText('The test: the simulated caller’s script')).toBeNull();
  });

  it('opening a case shows the test, expected vs this run, then the conversation', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Angry, asks to stop calling' }));
    const test = screen.getByRole('region', { name: 'The test' });
    expect(test).toHaveTextContent('Say angrily that they must stop calling you.');
    const table = within(screen.getByRole('region', { name: 'Expected vs this run' }));
    const rows = table.getAllByRole('row').map((one) => one.textContent);
    expect(rows[1]).toMatch(/Must call.*Code—✗not called: request_owner_callback/);
    expect(rows[2]).toMatch(/Promises saved.*Code🔒✓/);
    expect(rows[3]).toMatch(/Short turns.*Not checked in this run/);
    expect(rows[4]).toMatch(
      /Hands over to the owner.*AI judge.*The agent did not offer a callback/,
    );
    const talk = screen.getByRole('region', { name: 'The conversation' });
    expect(talk).toHaveTextContent('Asha: Namaste');
    expect(talk).toHaveTextContent('Simulated caller: Stop calling me');
    expect(talk).not.toHaveTextContent('assistant:');
  });

  it('a brain case shows expected vs got for the command, name and amount', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Praveen gave me 1,000 rupees yesterday' }),
    );
    const table = within(screen.getByRole('region', { name: 'Expected vs this run' }));
    const rows = table.getAllByRole('row').map((one) => one.textContent);
    expect(rows[1]).toBe('Commandmark_paidmark_paidCode🔒✓');
    expect(rows[2]).toBe('NamepraveenpraveenCode🔒✓');
    expect(rows[3]).toBe('Amount100010000Code🔒✗');
    expect(screen.getByRole('region', { name: 'The conversation' })).toHaveTextContent(
      'Brain (answered by sarvam): mark_paid',
    );
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

  it('a new case run on its own is shown, marked as outside the latest gate', async () => {
    const fake = fakeDashboard();
    const [asha, ...rest] = EVALS.targets;
    const first = asha?.cases[0];
    if (!asha || !first) throw new Error('fake evals need an Asha case');
    const alone = {
      ...asha.latest,
      id: 'run-alone',
      metrics: { ...asha.latest.metrics, only: 'asha-10' },
    };
    const added = {
      ...first,
      scenarioId: 'asha-10',
      ranAlone: { runId: 'run-alone', createdAt: '2026-11-23T10:00:00.000Z' },
    };
    fake.evals = {
      ...EVALS,
      targets: [
        { ...asha, cases: [...asha.cases, added], history: [alone, ...asha.history] },
        ...rest,
      ],
    };
    render(<EvalsPage dashboard={fake.dashboard} />);
    const row = (await screen.findByText('asha-10')).closest('tr');
    expect(row).toHaveTextContent(/New case, run on its own .*; not in this gate/);
    const trend = within(card(/Asha/)).getByRole('list', { name: 'Recent runs' });
    expect(within(trend).getAllByRole('listitem')[0]).toHaveTextContent('only asha-10');
  });

  it('shows the model choice table right after the WhatsApp brain', async () => {
    render(<EvalsPage dashboard={fakeDashboard().dashboard} />);
    const model = await screen.findByRole('heading', { name: 'Model choice' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent);
    const brain = headings.findIndex((text) => text?.startsWith('WhatsApp brain'));
    expect(headings[brain + 1]).toBe(model.textContent);
    expect(screen.getByText('sarvam-105b')).toBeInTheDocument();
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
