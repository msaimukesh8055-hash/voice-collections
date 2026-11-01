// scripts/agent-push.ts
// Validates the collections agent config and creates/updates it on Vapi.
// M1: plain push. M6 wraps this in the release gate (evals must pass first).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { collectionsAgent } from '../voice-agents/collections/assistant.config.ts';
import { AgentConfigSchema } from '../voice-agents/schema.ts';
import { buildAssistantPayload } from '../voice-agents/vapi-payload.ts';
import { pushAssistant, type HttpCall } from './lib/vapi-publish.ts';

const VAPI_API = 'https://api.vapi.ai';
const ID_FILE = new URL('../voice-agents/collections/vapi-assistant.json', import.meta.url);
const REQUEST_TIMEOUT_MS = 15_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function createVapiClient(privateKey: string): (call: HttpCall) => Promise<unknown> {
  return async function vapiRequest(call: HttpCall): Promise<unknown> {
    const response = await fetch(`${VAPI_API}${call.path}`, {
      method: call.method,
      headers: { Authorization: `Bearer ${privateKey}`, 'Content-Type': 'application/json' },
      body: call.body === undefined ? null : JSON.stringify(call.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    if (!response.ok)
      throw new Error(`Vapi ${call.method} ${call.path} failed: ${JSON.stringify(body)}`);
    return body;
  };
}

function readSavedId(): string | null {
  if (!existsSync(ID_FILE)) return null;
  const saved: unknown = JSON.parse(readFileSync(ID_FILE, 'utf8'));
  return typeof saved === 'object' && saved !== null && 'assistantId' in saved
    ? String(saved.assistantId)
    : null;
}

const config = AgentConfigSchema.parse(collectionsAgent);
const vapi = createVapiClient(requireEnv('VAPI_PRIVATE_KEY'));

const assistantId = await pushAssistant(vapi, {
  payload: buildAssistantPayload(config),
  savedId: readSavedId(),
});
const record = { assistantId, model: config.model.model, pushedAt: new Date().toISOString() };
writeFileSync(ID_FILE, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`Assistant pushed: ${assistantId} (${config.model.model})\n`);
