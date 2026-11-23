// web/src/features/calls/CallsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
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

  it('opened from Agent health: only the chosen calls, with a chip and a way back (2026-11-22)', async () => {
    const filter = { ids: [CALL.id, 'older-call'], label: 'Need a look' };
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={null} filter={filter} />);
    expect(await screen.findByText('Showing: Need a look (2)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nov/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Show all calls' })).toHaveAttribute('href', '/calls');
    expect(
      screen.getByText('1 of these are older than the calls listed here.'),
    ).toBeInTheDocument();
  });

  it('shows one call: facts, follow-up decision, summary, transcript and tool calls', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call with Ramesh' })).toBeInTheDocument();
    expect(screen.getByText('check promise')).toBeInTheDocument();
    expect(screen.getByText(/Promised to pay/)).toBeInTheDocument();
    expect(screen.getByText('Monday I will pay.')).toBeInTheDocument();
    // Readable timeline (2026-11-23): the tool in plain words, its real name small.
    expect(screen.getByText('Looked up the dues')).toBeInTheDocument();
    expect(screen.getByText('get_dues')).toBeInTheDocument();
    expect(screen.getByText('I will give on Monday.')).toBeInTheDocument();
    expect(screen.getByText('Telugu')).toBeInTheDocument();
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
  });

  it('shows the call scorecard (verdict, groups, values) and the call step by step', async () => {
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
        toolUse: [
          {
            tool: 'confirm_identity',
            needed: true,
            timesMs: [238],
            status: 'pass',
            why: '"Yes, I am Ramesh."',
          },
          {
            tool: 'log_promise',
            needed: true,
            timesMs: [444, 618, 125],
            status: 'pass',
            why: '"I will pay 2000 rupees by 25th November"',
          },
          {
            tool: 'record_payment_claim',
            needed: true,
            timesMs: [],
            status: 'fail',
            why: '"I already paid", but it never ran',
          },
          {
            tool: 'request_owner_callback',
            needed: false,
            timesMs: [],
            status: 'na',
            why: 'no dispute, hardship or request for the owner',
          },
        ],
        gaps: ['Tone and empathy are not judged yet.'],
      },
      trace: TRACE.steps,
    };
    const fake = fakeDashboard();
    const dashboard = { ...fake.dashboard, call: () => Promise.resolve(scored) };
    render(<CallsPage dashboard={dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: /^Call scorecard/ })).toBeInTheDocument();
    expect(screen.getByText('❌ A guardrail failed')).toBeInTheDocument();
    expect(screen.getByText(/18 of 21 checks passed/)).toBeInTheDocument();
    expect(screen.getByText('dues before identity')).toBeInTheDocument();
    // Latency's numbers moved to the timeline (2026-11-23); the scorecard keeps verdicts only.
    expect(screen.queryByText('1.1 s over 12 replies')).not.toBeInTheDocument();
    expect(screen.queryByText(/Not judged yet/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^What happened in the call/ })).toBeInTheDocument();
  });

  it('a miss in a group moved to the timeline still shows as one verdict line', async () => {
    const fake = fakeDashboard();
    const base = await fake.dashboard.call(CALL.id);
    const scored: CallDetail = {
      ...base,
      scorecard: {
        verdict: 'check',
        passed: 1,
        applicable: 2,
        groups: [
          {
            name: 'Tools',
            checks: [
              {
                id: 'no_double_tool',
                label: 'No tool called twice in a row',
                status: 'warn',
                value: 'request_owner_callback twice',
              },
            ],
          },
        ],
        toolUse: [],
        gaps: [],
      },
    };
    const dashboard = { ...fake.dashboard, call: () => Promise.resolve(scored) };
    render(<CallsPage dashboard={dashboard} id={CALL.id} />);
    expect(await screen.findByText(/Tools: No tool called twice in a row/)).toBeInTheDocument();
    expect(screen.queryByText('request_owner_callback twice')).not.toBeInTheDocument();
  });

  it('the timeline lists tools that did not run; a needed one in red (2026-11-23)', async () => {
    const fake = fakeDashboard();
    const base = await fake.dashboard.call(CALL.id);
    const scored: CallDetail = {
      ...base,
      scorecard: {
        verdict: 'check',
        passed: 3,
        applicable: 4,
        groups: [],
        toolUse: [
          {
            tool: 'record_payment_claim',
            needed: true,
            timesMs: [],
            status: 'fail',
            why: '"I already paid", but it never ran',
          },
          {
            tool: 'request_owner_callback',
            needed: false,
            timesMs: [],
            status: 'na',
            why: 'no dispute, hardship or request for the owner',
          },
        ],
        gaps: [],
      },
    };
    const dashboard = { ...fake.dashboard, call: () => Promise.resolve(scored) };
    render(<CallsPage dashboard={dashboard} id={CALL.id} />);
    const missed = await screen.findByText(/needed but never ran: "I already paid"/);
    expect(missed.closest('li')).toHaveClass('text-danger');
    expect(
      screen.getByText(/not needed, no dispute, hardship or request for the owner/),
    ).toBeInTheDocument();
    const timeline = screen.getByRole('heading', { name: /^What happened in the call/ });
    const transcript = screen.getByRole('heading', { name: 'Transcript' });
    expect(
      timeline.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('a section menu opens the section it names and puts it in the address', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={CALL.id} />);
    const [link] = await screen.findAllByRole('link', { name: /^Transcript/ });
    const section = document.getElementById('transcript');
    expect(section).not.toHaveAttribute('open');
    link?.click();
    await waitFor(() => expect(document.getElementById('transcript')).toHaveAttribute('open'));
    expect(window.location.hash).toBe('#transcript');
  });

  it('an older call without a scorecard or steps still shows the rest', async () => {
    render(<CallsPage dashboard={fakeDashboard().dashboard} id={CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call with Ramesh' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Call scorecard/ })).not.toBeInTheDocument();
    // No recorded steps: the timeline is built from the stored tool calls alone.
    expect(screen.getByText('Looked up the dues')).toBeInTheDocument();
  });
});
