// scripts/lib/vapi-publish.ts
// Vapi API steps used by the push script. The HTTP client is injected so tests never call Vapi.
import { z } from 'zod';

export interface HttpCall {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly body?: unknown;
}

export type HttpClient = (call: HttpCall) => Promise<unknown>;

const AssistantResponseSchema = z.object({ id: z.string().min(1) });

export interface PushRequest {
  readonly payload: unknown;
  readonly savedId: string | null;
}

/** Creates the assistant on first push, updates it afterwards (never duplicates). */
export async function pushAssistant(http: HttpClient, request: PushRequest): Promise<string> {
  const call: HttpCall = request.savedId
    ? { method: 'PATCH', path: `/assistant/${request.savedId}`, body: request.payload }
    : { method: 'POST', path: '/assistant', body: request.payload };
  const parsed = AssistantResponseSchema.safeParse(await http(call));
  if (!parsed.success) throw new Error('Vapi did not return an assistant id');
  return parsed.data.id;
}
