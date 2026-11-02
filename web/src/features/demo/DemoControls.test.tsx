// web/src/features/demo/DemoControls.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { AppApiError } from '../../lib/appApi.ts';
import { fakeApi } from '../../test/fakes.ts';
import { DemoControls } from './DemoControls.tsx';

describe('DemoControls', () => {
  it('shows the live shopkeeper and rings them', async () => {
    const fake = fakeApi();
    render(<DemoControls api={fake.api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ring Ramesh' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ringing Ramesh. Answer on the phone page.',
    );
    expect(screen.getByText('Ramesh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'phone page' })).toHaveAttribute('href', '/phone');
    expect(fake.requests).toEqual(['demo', 'ring']);
  });

  it('says when a call is already waiting', async () => {
    const fake = fakeApi();
    fake.alreadyQueued = true;
    render(<DemoControls api={fake.api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ring Ramesh' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ramesh is already being rung.');
  });

  it('shows the server reason when a ring is refused', async () => {
    const fake = fakeApi();
    render(<DemoControls api={fake.api} />);
    const button = await screen.findByRole('button', { name: 'Ring Ramesh' });
    fake.failure = new AppApiError('Calls are only allowed between 08:00 and 19:00 IST.', 'X');
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('08:00 and 19:00 IST');
  });

  it('explains when the demo settings cannot be loaded', async () => {
    const fake = fakeApi();
    fake.failure = new Error('offline');
    render(<DemoControls api={fake.api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the demo settings');
    expect(screen.getByRole('button', { name: 'Ring' })).toBeDisabled();
  });
});
