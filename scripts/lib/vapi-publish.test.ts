// scripts/lib/vapi-publish.test.ts
import { describe, expect, it } from 'vitest';
import { pushAssistant, type HttpCall, type HttpClient } from './vapi-publish.ts';

function fakeHttp(responses: readonly unknown[]): { client: HttpClient; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const queue = [...responses];
  async function client(call: HttpCall): Promise<unknown> {
    calls.push(call);
    return queue.shift();
  }
  return { client, calls };
}

const PAYLOAD = { name: 'suvidha-collections' };

describe('pushAssistant', () => {
  it('creates the assistant when no id is saved', async () => {
    const { client, calls } = fakeHttp([{ id: 'asst_new' }]);
    const id = await pushAssistant(client, { payload: PAYLOAD, savedId: null });
    expect(id).toBe('asst_new');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/assistant' });
  });

  it('updates the saved assistant instead of creating a duplicate', async () => {
    const { client, calls } = fakeHttp([{ id: 'asst_1' }]);
    await pushAssistant(client, { payload: PAYLOAD, savedId: 'asst_1' });
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/assistant/asst_1' });
  });

  it('rejects a response without an assistant id', async () => {
    const { client } = fakeHttp([{ message: 'Bad Request' }]);
    await expect(pushAssistant(client, { payload: PAYLOAD, savedId: null })).rejects.toThrow(
      'Vapi did not return an assistant id',
    );
  });
});
