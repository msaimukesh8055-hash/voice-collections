// supabase/functions/_shared/whatsapp/media.ts
// Meta's media API (M6): download a voice note the owner sent (GET /{media-id} gives a short-lived
// link, then GET that link, both with our token), and upload a file we send back (a Bulbul voice
// reply or the insights pie chart) to get a media id. Files are held in memory only, never
// stored. Failures are logged with Meta's error code only (the token must never leak).
import { z } from 'zod';
import type { Logger } from '../log.ts';
import { GRAPH_API_BASE } from './client.ts';

/** A voice note over this is refused before it is downloaded or transcribed (M6 Decision 10). */
export const MAX_VOICE_BYTES = 1_000_000;
const MEDIA_TIMEOUT_MS = 10_000;

export interface MediaConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
}

export type Download =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array<ArrayBuffer>; readonly mimeType: string }
  | { readonly kind: 'too_big' }
  | { readonly kind: 'failed' };

const MediaInfo = z.object({
  url: z.url(),
  mime_type: z.string(),
  file_size: z.number().optional(),
});
const Uploaded = z.object({ id: z.string().min(1) });

function auth(config: MediaConfig): Record<string, string> {
  return { authorization: `Bearer ${config.accessToken}` };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

class MetaMediaError extends Error {
  override name = 'MetaMediaError';
  constructor(readonly status: number) {
    super(`meta media http ${status}`);
  }
}

async function getOk(config: MediaConfig, url: string): Promise<Response> {
  const response = await config.fetchImpl(url, {
    headers: auth(config),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!response.ok) throw new MetaMediaError(response.status);
  return response;
}

/** Downloads one media file sent to our number; too big → refused without downloading it. */
export async function downloadMedia(config: MediaConfig, mediaId: string): Promise<Download> {
  try {
    const infoUrl = `${GRAPH_API_BASE}/${encodeURIComponent(mediaId)}`;
    const info = MediaInfo.parse(await (await getOk(config, infoUrl)).json());
    if ((info.file_size ?? 0) > MAX_VOICE_BYTES) return { kind: 'too_big' };
    const bytes = new Uint8Array(await (await getOk(config, info.url)).arrayBuffer());
    if (bytes.length > MAX_VOICE_BYTES) return { kind: 'too_big' };
    return { kind: 'ok', bytes, mimeType: info.mime_type };
  } catch (error) {
    const status = error instanceof MetaMediaError ? error.status : null;
    config.log('warn', 'media_download_failed', { error: errorName(error), status });
    return { kind: 'failed' };
  }
}

export interface Upload {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
  readonly fileName: string;
}

/** Uploads a file for one message; Meta's media id, or null (logged) when it failed. */
export async function uploadMedia(config: MediaConfig, file: Upload): Promise<string | null> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.mimeType);
  form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.fileName);
  try {
    const response = await config.fetchImpl(`${GRAPH_API_BASE}/${config.phoneNumberId}/media`, {
      method: 'POST',
      headers: auth(config),
      body: form,
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) throw new MetaMediaError(response.status);
    return Uploaded.parse(await response.json()).id;
  } catch (error) {
    const status = error instanceof MetaMediaError ? error.status : null;
    config.log('warn', 'media_upload_failed', { error: errorName(error), status });
    return null;
  }
}
