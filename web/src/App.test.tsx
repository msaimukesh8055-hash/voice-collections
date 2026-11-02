// web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './App.tsx';
import type { CallsApi } from './lib/callsApi.ts';
import type { VoiceClient } from './lib/vapiClient.ts';

const idleClient: VoiceClient = {
  async start() {},
  async stop() {},
  subscribe() {
    return function unsubscribe() {};
  },
};

const emptyApi: CallsApi = {
  async listCustomers() {
    return [];
  },
  async authoriseCall() {
    return { ok: false, message: 'unused' };
  },
};

describe('App', () => {
  it('renders the test call page', () => {
    render(<App client={idleClient} api={emptyApi} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test call');
  });
});
