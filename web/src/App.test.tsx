// web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import type { VoiceClient } from './lib/vapiClient.ts';

const idleClient: VoiceClient = {
  async start() {},
  async stop() {},
  subscribe() {
    return function unsubscribe() {};
  },
};

describe('App', () => {
  it('renders the voice spike page', () => {
    render(<App client={idleClient} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test call');
  });
});
