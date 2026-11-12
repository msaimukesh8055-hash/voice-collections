// web/src/features/ops/OpsPage.test.tsx
import { render, screen, within } from '@testing-library/react';
import { fakeDashboard, OPS, TRACE_ID } from '../../test/dashboardFakes.ts';
import { OpsPage } from './OpsPage.tsx';

function tile(name: RegExp): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (!section) throw new Error(`No tile ${String(name)}`);
  return section;
}

describe('OpsPage', () => {
  it('shows error rate, rejected LLM answers, the queue and spend against the cap', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    await screen.findByRole('heading', { name: /Error rate/ });
    expect(within(tile(/Error rate/)).getByText('2.5%')).toBeInTheDocument();
    expect(within(tile(/Error rate/)).getByText('1 of 40 requests failed')).toBeInTheDocument();
    expect(within(tile(/Error rate/)).getByText('7 days: 10% (30 of 300)')).toBeInTheDocument();
    expect(within(tile(/Rejected LLM answers/)).getByText('15%')).toBeInTheDocument();
    expect(
      within(tile(/Rejected LLM answers/)).getByText('sarvam: 3 rejected, 1 failed of 20'),
    ).toBeInTheDocument();
    expect(within(tile(/answered in code/)).getByText('75%')).toBeInTheDocument();
    expect(within(tile(/Follow-up queue/)).getByText('Clear')).toBeInTheDocument();
    expect(within(tile(/Spend this month/)).getByText('₹84.49 of ₹1,000')).toBeInTheDocument();
    expect(
      within(tile(/Spend this month/)).getByText('Voice ₹41.30 · LLM ₹43.19'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8');
  });

  it('marks each tool against the 500 ms target in words', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const fast = (await screen.findByText('get_dues')).closest('tr');
    const slow = screen.getByText('book_summary').closest('tr');
    expect(fast).toHaveTextContent('310 ms');
    expect(fast).toHaveTextContent('Within');
    expect(slow).toHaveTextContent('640 ms');
    expect(slow).toHaveTextContent('Over');
  });

  it('lists the latest errors, each linking to its trace', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: /whatsapp_background_failed/ });
    expect(link).toHaveAttribute('href', `/ops?id=${TRACE_ID}`);
    expect(screen.getByText('whatsapp-webhook · RepositoryError')).toBeInTheDocument();
  });

  it('says so when a queue is stuck, and copes with nothing recorded yet', async () => {
    const fake = fakeDashboard();
    fake.ops = {
      ...OPS,
      day: { requests: 0, failed: 0 },
      llm: [],
      tools: [],
      sources: [],
      recentErrors: [],
      followups: { waiting: 3, stuck: 2, failedWeek: 0 },
    };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('2 stuck')).toBeInTheDocument();
    expect(within(tile(/Error rate/)).getByText('–')).toBeInTheDocument();
    expect(screen.getByText('No LLM calls recorded yet')).toBeInTheDocument();
    expect(screen.getByText('No tool calls in the last 7 days.')).toBeInTheDocument();
    expect(screen.getByText('No errors in the last 7 days.')).toBeInTheDocument();
  });

  it('shows one trace as a timeline: time since the start, status in words, facts', async () => {
    const fake = fakeDashboard();
    render(<OpsPage dashboard={fake.dashboard} id={TRACE_ID} />);
    expect(await screen.findByText('brain_llm')).toBeInTheDocument();
    expect(fake.requests).toEqual([`trace:${TRACE_ID}`]);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('+0 ms');
    expect(steps[0]).toHaveTextContent('Warning');
    expect(steps[0]).toHaveTextContent('whatsapp-webhook · 412 ms · sarvam · bad_json');
    expect(steps[1]).toHaveTextContent('+1.25 s');
    expect(steps[1]).toHaveTextContent('812 tokens in, 44 out');
    expect(steps[1]).toHaveTextContent('model: gemini-2.5-flash');
    expect(steps[2]).toHaveTextContent('Error');
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All ops/ })).toHaveAttribute('href', '/ops');
  });

  it('shows whether reminder calls are running or paused, in words', async () => {
    const running = render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    await screen.findByRole('heading', { name: 'Reminder calls' });
    expect(within(tile(/^Reminder calls$/)).getByText('Running')).toBeInTheDocument();
    running.unmount();
    const fake = fakeDashboard();
    fake.ops = { ...OPS, callsPaused: true };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    await screen.findByRole('heading', { name: 'Reminder calls' });
    expect(within(tile(/^Reminder calls$/)).getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText(/until \/resume is sent/)).toBeInTheDocument();
  });

  it('asks for the WhatsApp link when there is none', async () => {
    const fake = fakeDashboard();
    fake.needsLink = true;
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('Open the dashboard from WhatsApp')).toBeInTheDocument();
  });
});
