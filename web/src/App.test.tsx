// web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import { fakeApi, fakeVoice } from './test/fakes.ts';

describe('App', () => {
  it('renders the home page with the demo controls', async () => {
    render(<App api={fakeApi().api} voice={fakeVoice().client} path="/" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Easy Recovery AI');
    expect(await screen.findByRole('button', { name: 'Ring Ramesh' })).toBeInTheDocument();
  });

  it('renders the phone page on /phone', async () => {
    render(<App api={fakeApi().api} voice={fakeVoice().client} path="/phone/" />);
    expect(await screen.findByRole('heading', { name: 'Waiting for a call…' })).toBeInTheDocument();
  });
});
