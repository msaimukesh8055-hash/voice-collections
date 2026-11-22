// web/src/features/whatsapp/WhatsAppPage.test.tsx
// WhatsApp live checks (2026-11-22): the list with each message's result, one message's report
// with what he sent and the bot's reply, the scorecard, and "Add as a test case" pre-filled.
import { fireEvent, render, screen } from '@testing-library/react';
import { EXCHANGE, EXCHANGE_ROW, fakeDashboard } from '../../test/dashboardFakes.ts';
import { WhatsAppPage } from './WhatsAppPage.tsx';

describe('WhatsAppPage', () => {
  it('lists each message with what he sent and its result', async () => {
    render(<WhatsAppPage dashboard={fakeDashboard().dashboard} id={null} />);
    const link = await screen.findByRole('link', { name: /Nov/ });
    expect(link).toHaveAttribute('href', `/whatsapp?id=${EXCHANGE_ROW.id}`);
    expect(screen.getByText('Ramesh 5000 due 15th')).toBeInTheDocument();
    expect(screen.getByText('✅ Went well')).toBeInTheDocument();
    expect(screen.getByText('⚙️ Code · no AI')).toBeInTheDocument();
    expect(screen.queryByText('Test')).toBeNull();
  });

  it('says why a message needs a look', async () => {
    const fake = fakeDashboard();
    const slow = {
      ...EXCHANGE_ROW,
      handleMs: 8400,
      verdict: 'check' as const,
      reasons: ['wa_reply_time'],
    };
    fake.dashboard.exchanges = () => Promise.resolve([slow]);
    render(<WhatsAppPage dashboard={fake.dashboard} id={null} />);
    expect(await screen.findByText('⚠ Needs a look')).toBeInTheDocument();
    expect(screen.getByText('slow reply (8.4 s)')).toBeInTheDocument();
  });

  it('shows only the messages Agent health asked for, and tags smoke-test ones', async () => {
    const fake = fakeDashboard();
    fake.dashboard.exchanges = () =>
      Promise.resolve([EXCHANGE_ROW, { ...EXCHANGE_ROW, id: 'e2', isTest: true, inText: 'hi' }]);
    render(
      <WhatsAppPage dashboard={fake.dashboard} id={null} filter={{ ids: ['e2'], label: 'Test' }} />,
    );
    expect(await screen.findByText('hi')).toBeInTheDocument();
    expect(screen.queryByText('Ramesh 5000 due 15th')).toBeNull();
    expect(screen.getByRole('link', { name: 'Show all messages' })).toHaveAttribute(
      'href',
      '/whatsapp',
    );
  });

  it('one message: what he sent, the reply, the scorecard and a pre-filled test case', async () => {
    const fake = fakeDashboard();
    render(<WhatsAppPage dashboard={fake.dashboard} id={EXCHANGE.exchange.id} />);
    expect(await screen.findByText('WhatsApp message to the bot')).toBeInTheDocument();
    expect(screen.getByText(/\[Save\] \[Edit\] \[Cancel\]/)).toBeInTheDocument();
    expect(screen.getByText('✅ Message went well')).toBeInTheDocument();
    expect(screen.getByText('Message scorecard')).toBeInTheDocument();
    expect(screen.getByText(/Kept for 30 days/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add as a test case/ }));
    expect(screen.getByDisplayValue('Ramesh 5000 due 15th')).toBeInTheDocument();
  });
});
