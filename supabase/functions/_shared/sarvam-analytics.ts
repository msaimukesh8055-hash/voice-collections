// supabase/functions/_shared/sarvam-analytics.ts
// Live-call transcripts from Sarvam's Analytics API (SPEC §8.1, M5 Decision 5), with the Voice
// Agents key in an X-API-Key header (server side only). Shapes checked with read-only GETs on
// 2026-11-03:
//   GET {base}/{org}/{ws}/{app}/transcripts/{interaction_id}
//     → { interaction_id, messages: [{ turn_id, role: 'assistant' | 'user', content, language_name }] }
//   GET {base}/{org}/{ws}/{app}/interactions?start_datetime&end_datetime
//     → { items: [{ interaction_id, agent_variables: { call_token, … }, … }], total, … }
// The transcript can lag behind the call: 404 or no messages yet = "not ready", and the worker
// tries again. Nothing from Sarvam's body is logged (it holds the conversation).
import { z } from 'zod';
import type { Logger } from './log.ts';

export const SARVAM_ANALYTICS_BASE = 'https://apps.sarvam.ai/api/analytics/v1';
const ANALYTICS_TIMEOUT_MS = 10_000;
const HTTP_NOT_FOUND = 404;
export const MAX_TURNS = 80;
export const MAX_TURN_CHARS = 1_000;
/** Sarvam ids look like "20261102/182f511f-21:45:10-8bfe8bd5". */
const INTERACTION_ID = /^[\w:.-]+(\/[\w:.-]+)*$/;
const MAX_INTERACTION_ID_LENGTH = 160;

export interface Turn {
  readonly role: 'assistant' | 'user';
  readonly content: string;
}

export type TranscriptResult =
  | { readonly kind: 'ready'; readonly turns: readonly Turn[] }
  | { readonly kind: 'not_ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export interface AnalyticsConfig {
  readonly apiKey: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly appId: string | null;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface TranscriptClient {
  fetchTranscript(interactionId: string): Promise<TranscriptResult>;
  /** Backup when the phone page never reported the id: match our call token in the call's
   * agent variables. Null when not found (or on any error, already logged). */
  findInteractionId(callToken: string, window: TimeWindow): Promise<string | null>;
}

const TranscriptSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

const InteractionsSchema = z.object({
  items: z.array(z.object({
    interaction_id: z.string(),
    agent_variables: z.record(z.string(), z.unknown()).nullish(),
  })),
});

class AnalyticsError extends Error {
  override name = 'AnalyticsError';
}

export function isInteractionId(value: string): boolean {
  return value.length <= MAX_INTERACTION_ID_LENGTH && INTERACTION_ID.test(value) &&
    !value.split('/').includes('..');
}

function toTurns(messages: z.infer<typeof TranscriptSchema>['messages']): readonly Turn[] {
  return messages
    .filter((message): message is Turn => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_TURN_CHARS),
    }))
    .filter((turn) => turn.content !== '')
    .slice(0, MAX_TURNS);
}

function reasonOf(error: unknown): string {
  if (error instanceof AnalyticsError) return error.message;
  if (error instanceof z.ZodError) return 'unexpected_shape';
  return error instanceof Error ? error.name : 'unknown';
}

export function createTranscriptClient(config: AnalyticsConfig): TranscriptClient {
  async function getJson(appId: string, path: string): Promise<unknown | null> {
    const app = [config.orgId, config.workspaceId, appId].map(encodeURIComponent).join('/');
    const response = await config.fetchImpl(`${SARVAM_ANALYTICS_BASE}/${app}/${path}`, {
      headers: { 'X-API-Key': config.apiKey },
      signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
    });
    if (response.status === HTTP_NOT_FOUND) return null;
    if (!response.ok) throw new AnalyticsError(`HTTP ${response.status}`);
    return await response.json();
  }

  async function fetchTranscript(interactionId: string): Promise<TranscriptResult> {
    if (config.appId === null) return { kind: 'failed', reason: 'not_configured' };
    if (!isInteractionId(interactionId)) return { kind: 'failed', reason: 'bad_interaction_id' };
    try {
      const body = await getJson(config.appId, `transcripts/${interactionId}`);
      if (body === null) return { kind: 'not_ready' };
      const turns = toTurns(TranscriptSchema.parse(body).messages);
      return turns.length === 0 ? { kind: 'not_ready' } : { kind: 'ready', turns };
    } catch (error) {
      config.log('warn', 'transcript_fetch_failed', { reason: reasonOf(error) });
      return { kind: 'failed', reason: reasonOf(error) };
    }
  }

  async function findInteractionId(callToken: string, window: TimeWindow): Promise<string | null> {
    if (config.appId === null) return null;
    const query = new URLSearchParams({
      start_datetime: window.from.toISOString(),
      end_datetime: window.to.toISOString(),
    });
    try {
      const body = InteractionsSchema.parse(await getJson(config.appId, `interactions?${query}`));
      const match = body.items.find((item) => item.agent_variables?.['call_token'] === callToken);
      return match?.interaction_id ?? null;
    } catch (error) {
      config.log('warn', 'interaction_lookup_failed', { reason: reasonOf(error) });
      return null;
    }
  }

  return { fetchTranscript, findInteractionId };
}
