// web/src/features/ops/OpsPage.test.tsx
import { render, screen, within } from '@testing-library/react';
import { fakeDashboard, OPS, OPS_STATUS, TRACE_ID } from '../../test/dashboardFakes.ts';
import { OpsPage } from './OpsPage.tsx';

async function card(name: string | RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`No card ${String(name)}`);
  return section;
}

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

  it('groups errors by kind, each linking to its latest trace', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: 'followup-worker · worker_job_failed' });
    expect(link).toHaveAttribute('href', `/ops?id=${TRACE_ID}`);
    expect(screen.getByText(/TimeoutError · 10× · last/)).toBeInTheDocument();
  });

  it('an older server without status still lists the latest errors', async () => {
    const fake = fakeDashboard();
    fake.ops = { ...OPS, status: null };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: /whatsapp_background_failed/ });
    expect(link).toHaveAttribute('href', `/ops?id=${TRACE_ID}`);
    expect(screen.queryByRole('heading', { name: 'Status' })).toBeNull();
  });

  it('shows up or down, uptime and since when it is measured', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const status = within(await card('Status'));
    expect(status.getByText('Up')).toBeInTheDocument();
    expect(status.getAllByText('93.33%')).toHaveLength(3);
    expect(status.getAllByText('14 of 15 probes')).toHaveLength(3);
    expect(status.getByText(/Measured since .*the first health probe/)).toBeInTheDocument();
    expect(status.getByText(/version abc1234/)).toBeInTheDocument();
  });

  it('before the first probe it says so instead of showing uptime', async () => {
    const fake = fakeDashboard();
    const empty = {
      ...OPS_STATUS,
      measuredSince: null,
      uptime: { day: null, week: null, all: null },
    };
    fake.ops = {
      ...OPS,
      status: {
        ...empty,
        now: { state: 'unknown', checkedAt: null, durationMs: null, version: null },
      },
    };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    const status = within(await card('Status'));
    expect(status.getAllByText('Not measured yet').length).toBeGreaterThan(0);
    expect(status.getAllByText('no probes')).toHaveLength(3);
    expect(status.getByText('The first health probe has not run yet.')).toBeInTheDocument();
  });

  it('service targets: met, missed or no data, each with how it is worked out', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const targets = within(await card('Service targets'));
    const row = (name: string): HTMLElement | null => targets.getByText(name).closest('tr');
    expect(row('App API up')).toHaveTextContent('Missed');
    expect(row('Requests that worked')).toHaveTextContent('Met');
    expect(row('WhatsApp message handled')).toHaveTextContent('No data yet');
    expect(targets.getByText('Requests whose trace has no error step.')).toBeInTheDocument();
  });

  it('lists what we depend on and the scheduled jobs, state in words', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const services = within(await card(/What we depend on/));
    expect(services.getByText('Sarvam voice agents').closest('tr')).toHaveTextContent(
      'Working (failed earlier)',
    );
    expect(services.getByText('Gemini').closest('tr')).toHaveTextContent('Not used in 7 days');
    const jobs = within(await card('Scheduled jobs'));
    expect(jobs.getByText('followup-sweep').closest('tr')).toHaveTextContent('On time');
    expect(jobs.getByText('health-probe').closest('tr')).toHaveTextContent('Not run yet');
    expect(jobs.getByText('1440 of 1440 runs reached the worker.')).toBeInTheDocument();
  });

  it('every tile says how its figure is calculated; latency tables are folded away', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    await screen.findByRole('heading', { name: /Error rate/ });
    expect(within(tile(/Spend this month/)).getByText(/× ₹3.50 \+ GST/)).toBeInTheDocument();
    expect(within(tile(/Follow-up queue/)).getByText(/stuck means/)).toBeInTheDocument();
    const folded = screen.getByText('Latency details: tools and functions').closest('details');
    expect(folded).not.toHaveAttribute('open');
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
      status: { ...OPS_STATUS, errorGroups: [] },
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
