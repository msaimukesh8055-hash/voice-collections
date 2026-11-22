// web/src/features/munshi-calls/MunshiCallsPage.test.tsx
import { render, screen } from '@testing-library/react';
import { fakeDashboard, OWNER_CALL } from '../../test/dashboardFakes.ts';
import { MunshiCallsPage } from './MunshiCallsPage.tsx';

describe('MunshiCallsPage', () => {
  it('lists the owner calls to Munshi with a link to each report', async () => {
    render(<MunshiCallsPage dashboard={fakeDashboard().dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: /Nov/ });
    expect(link).toHaveAttribute('href', `/munshi-calls?id=${OWNER_CALL.id}`);
    expect(screen.getByText('₹12.39')).toBeInTheDocument();
    expect(screen.queryByText('Test call')).toBeNull();
  });

  it('tags a call a test script opened, and keeps it in the list', async () => {
    const fake = fakeDashboard();
    fake.dashboard.ownerCalls = () => Promise.resolve([{ ...OWNER_CALL, isTest: true }]);
    render(<MunshiCallsPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('Test call')).toHaveAttribute(
      'title',
      expect.stringContaining('Left out of Agent health'),
    );
    expect(screen.getByRole('link', { name: /Nov/ })).toBeInTheDocument();
  });

  it('one report: facts, scorecard, tools needed vs ran above the transcript', async () => {
    const fake = fakeDashboard();
    render(<MunshiCallsPage dashboard={fake.dashboard} id={OWNER_CALL.id} />);
    expect(await screen.findByRole('heading', { name: 'Call with Munshi' })).toBeInTheDocument();
    expect(fake.requests).toContain(`owner-call:${OWNER_CALL.id}`);
    expect(screen.getByRole('heading', { name: 'Call scorecard' })).toBeInTheDocument();
    expect(screen.getByText('Every change read back before it was saved')).toBeInTheDocument();
    const tools = screen.getByRole('heading', { name: 'Tools: needed vs ran' });
    const transcript = screen.getByRole('heading', { name: 'Transcript' });
    expect(
      tools.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('"How much does Ramesh owe?"')).toBeInTheDocument();
    expect(screen.getByText('How much does Ramesh owe?')).toBeInTheDocument();
  });
});
