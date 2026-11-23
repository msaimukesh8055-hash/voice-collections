// web/src/features/ops/OpsPage.test.tsx
// Ops is the shared machine only (Saim, 2026-11-23): a top line, then folding sections (Now,
// Errors, Outside services, Background jobs, Money, Details), each target next to its number.
import { render, screen, within } from '@testing-library/react';
import { fakeDashboard, OPS, OPS_STATUS, TRACE_ID } from '../../test/dashboardFakes.ts';
import { OpsPage } from './OpsPage.tsx';

/** One folding section, found by its heading. */
async function section(name: string | RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const found = heading.closest('details');
  if (!found) throw new Error(`No section ${String(name)}`);
  return found;
}

describe('OpsPage', () => {
  it('says in one line what needs attention; nothing about agents or tools', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(await screen.findByText('⚠ 1 thing needs attention: App API up')).toBeInTheDocument();
    expect(screen.queryByText(/get_dues|Agent tool|WhatsApp answered in code/)).toBeNull();
    const menu = screen.getAllByRole('navigation', { name: 'Sections' })[0];
    expect(menu).toHaveTextContent(
      /Now.*Errors.*Outside services.*Background jobs.*Money.*Details/,
    );
  });

  it('all working says so', async () => {
    const fake = fakeDashboard();
    const targets = OPS_STATUS.targets.map((one) => ({
      ...one,
      met: one.met !== null ? true : null,
    }));
    fake.ops = { ...OPS, status: { ...OPS_STATUS, targets } };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('✓ All working')).toBeInTheDocument();
  });

  it('money: spend against the ₹1,000 cap, with its target beside it', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const money = within(await section(/^Money/));
    expect(money.getByText('₹84.49 of ₹1,000 this month')).toBeInTheDocument();
    expect(money.getByText(/Voice ₹41.30 · LLM ₹43.19/)).toBeInTheDocument();
    expect(money.getByText(/× ₹3.50 \+ GST/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8');
  });

  it('the Sarvam LLM row says how many answers were rejected', async () => {
    const fake = fakeDashboard();
    const sarvam = {
      name: 'Sarvam LLM (sarvam-105b)',
      use: 'WhatsApp brain',
      calls: 20,
      failed: 1,
      lastFailedAt: null,
      state: 'recovered' as const,
      how: 'Our calls to the model in 7 days.',
    };
    fake.ops = { ...OPS, status: { ...OPS_STATUS, services: [sarvam, ...OPS_STATUS.services] } };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    const services = within(await section(/^Outside services/));
    expect(services.getByText('3 of 20 answers rejected as badly shaped')).toBeInTheDocument();
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
    const status = within(await section(/^Now/));
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
    const status = within(await section(/^Now/));
    expect(status.getAllByText('Not measured yet').length).toBeGreaterThan(0);
    expect(status.getAllByText('no probes')).toHaveLength(3);
    expect(status.getByText('The first health probe has not run yet.')).toBeInTheDocument();
  });

  it('each target sits next to its own number: met, missed or no data', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const now = within(await section(/^Now/));
    expect(now.getByText('Target: 99.5% of probes, 7 days').closest('div')).toHaveTextContent(
      'Missed',
    );
    const errors = within(await section(/^Errors/));
    expect(errors.getByText('Target: 99%, 7 days').closest('div')).toHaveTextContent('Met');
    expect(errors.getByText('Requests whose trace has no error step.')).toBeInTheDocument();
    const jobs = within(await section(/^Background jobs/));
    expect(jobs.getByText('Target: Every job, last 24 h').closest('div')).toHaveTextContent(
      'No data yet',
    );
  });

  it('lists what we depend on and the scheduled jobs, state in words', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const services = within(await section(/^Outside services/));
    expect(services.getByText('Sarvam voice agents').closest('tr')).toHaveTextContent(
      'Working (failed earlier)',
    );
    expect(services.getByText('Gemini').closest('tr')).toHaveTextContent('Not used in 7 days');
    const jobs = within(await section(/^Background jobs/));
    expect(jobs.getByText('followup-sweep').closest('tr')).toHaveTextContent('On time');
    expect(jobs.getByText('health-probe').closest('tr')).toHaveTextContent('Not run yet');
    expect(jobs.getByText('1440 of 1440 runs reached the worker.')).toBeInTheDocument();
  });

  it('only the first section starts open; function times sit in Details', async () => {
    render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(await section(/^Now/)).toHaveAttribute('open');
    const details = await section(/^Details/);
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('Time per function · 24 hours')).toBeInTheDocument();
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
    expect(screen.getByText('3 waiting now · 0 failed in 7 days')).toBeInTheDocument();
    expect(screen.getByText('No errors in the last 7 days.')).toBeInTheDocument();
  });

  it('shows one trace as the readable timeline, the raw steps in its technical fold', async () => {
    const fake = fakeDashboard();
    render(<OpsPage dashboard={fake.dashboard} id={TRACE_ID} />);
    expect(await screen.findByText('AI read the message')).toBeInTheDocument();
    expect(fake.requests).toEqual([`trace:${TRACE_ID}`]);
    expect(screen.getByText(/3 steps over .* · 1 failed/)).toBeInTheDocument();
    const raw = screen.getByText('Technical details').closest('details');
    expect(raw).not.toHaveAttribute('open');
    expect(within(raw as HTMLElement).getAllByText('whatsapp_background_failed').length).toBe(1);
    expect(screen.getByRole('link', { name: /All ops/ })).toHaveAttribute('href', '/ops');
  });

  it('shows whether reminder calls are running or paused, in words', async () => {
    const running = render(<OpsPage dashboard={fakeDashboard().dashboard} id={null} />);
    expect(within(await section(/^Now/)).getByText('Running')).toBeInTheDocument();
    running.unmount();
    const fake = fakeDashboard();
    fake.ops = { ...OPS, callsPaused: true };
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    expect(within(await section(/^Now/)).getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText(/until \/resume is sent/)).toBeInTheDocument();
  });

  it('asks for the WhatsApp link when there is none', async () => {
    const fake = fakeDashboard();
    fake.needsLink = true;
    render(<OpsPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('Open the dashboard from WhatsApp')).toBeInTheDocument();
  });
});
