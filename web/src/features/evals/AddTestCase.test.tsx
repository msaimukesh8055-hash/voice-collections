// web/src/features/evals/AddTestCase.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { fakeDashboard } from '../../test/dashboardFakes.ts';
import { AddTestCase } from './AddTestCase.tsx';
import { EvalsPage } from './EvalsPage.tsx';

describe('AddTestCase', () => {
  it('a call draft sends only the call and what should have happened', async () => {
    const fake = fakeDashboard();
    render(<AddTestCase dashboard={fake.dashboard} source="munshi_call" refId="call-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add as a test case' }));
    expect(screen.getByText(/taken from this call/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/What should have happened/), {
      target: { value: 'Say who paid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Added to the tests waiting/)).toBeInTheDocument();
    expect(fake.drafts).toEqual([
      { source: 'munshi_call', refId: 'call-1', expected: 'Say who paid' },
    ]);
  });

  it('a WhatsApp draft needs what he sent before it can be saved', async () => {
    const fake = fakeDashboard();
    render(<AddTestCase dashboard={fake.dashboard} source="whatsapp" refId="trace-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add as a test case' }));
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What did you send/), {
      target: { value: 'ramesh 2000 jama' },
    });
    fireEvent.click(save);
    expect(await screen.findByText(/Added to the tests waiting/)).toBeInTheDocument();
    expect(fake.drafts[0]).toEqual({
      source: 'whatsapp',
      refId: 'trace-1',
      said: 'ramesh 2000 jama',
    });
  });

  it('the Evals page lists drafts from live use, linking to the call', async () => {
    const fake = fakeDashboard();
    render(<EvalsPage dashboard={fake.dashboard} />);
    expect(await screen.findByText('From live use (2 waiting)')).toBeInTheDocument();
    expect(screen.getByText(/Who has paid me this month\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Munshi call ·/ })).toHaveAttribute(
      'href',
      '/munshi-calls?id=e6d73ff4-0dd8-4565-99a9-ed6b00651029',
    );
    expect(screen.getByRole('link', { name: /^WhatsApp chat ·/ })).toHaveAttribute(
      'href',
      '/whatsapp?id=e0000000-0000-4000-8000-000000000001',
    );
  });
});
