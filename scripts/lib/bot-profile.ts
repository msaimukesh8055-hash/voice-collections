// scripts/lib/bot-profile.ts
// The bot's WhatsApp profile (M7 A2, Decisions 5 and 6): the logo as profile photo, the About
// line, description, category and website, set on the Meta test number in four steps:
//   1. POST {graph}/{app id}/uploads?file_name&file_length&file_type → upload session id
//   2. POST {graph}/{session id} (Authorization: OAuth, file_offset: 0, the PNG bytes) → handle h
//   3. POST {graph}/{phone number id}/whatsapp_business_profile with the texts and the handle
//   4. GET  the same profile back and print what Meta now has
// Every Meta reply is checked with Zod. Errors print the HTTP status and Meta's code/subcode
// only; the token is never printed (it goes in headers, never in a URL). A dry run prints what
// would be sent and calls nothing. fetch and the output are injected, so all of it is tested.
// ⚠️ The texts are drafts approved by Saim on 2026-11-07.
import { z } from 'zod';
import { GRAPH_API_BASE } from '../../supabase/functions/_shared/whatsapp/client.ts';

export const LOGO_SIZE = 640;
/** Meta's limit for a profile photo. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const LOGO_FILE_NAME = 'logo-640.png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Width and height sit in the IHDR chunk right after the 8-byte signature and its header. */
const IHDR_WIDTH_AT = 16;
const IHDR_HEIGHT_AT = 20;

/** Meta's business categories (WhatsApp Business Profile `vertical`). */
export const VERTICALS = [
  'UNDEFINED',
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
  'NOT_A_BIZ',
] as const;

export const ProfileTextSchema = z.object({
  about: z.string().min(1).max(139),
  description: z.string().max(512),
  vertical: z.enum(VERTICALS),
  websites: z.array(z.url({ protocol: /^https$/ })).max(2),
});
export type ProfileText = z.infer<typeof ProfileTextSchema>;

export const ABOUT = 'Easy Recovery AI · your credit book on WhatsApp';
export const DESCRIPTION =
  "Easy Recovery AI keeps Sri Lakshmi Traders' credit book on WhatsApp. " +
  'Ask who owes you, add credit by text or voice note, record payments, and get due alerts and ' +
  'insights. Asha, the voice assistant, makes polite reminder calls. Demo prototype with fake ' +
  'data, built on Sarvam AI.';
export const VERTICAL = 'FINANCE';

/** The profile texts; the website is the deployed dashboard, only when it is an https address. */
export function profileText(website: string | null): ProfileText {
  const websites = website?.startsWith('https://') ? [website] : [];
  return ProfileTextSchema.parse({
    about: ABOUT,
    description: DESCRIPTION,
    vertical: VERTICAL,
    websites,
  });
}

function readUint32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
}

/** Width and height from a PNG header, or null when it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!isPng || bytes.length < IHDR_HEIGHT_AT + 4) return null;
  return { width: readUint32(bytes, IHDR_WIDTH_AT), height: readUint32(bytes, IHDR_HEIGHT_AT) };
}

/** Why this file cannot be the profile photo, or null when it can. */
export function logoProblem(bytes: Uint8Array): string | null {
  const size = pngSize(bytes);
  if (!size) return 'the logo is not a PNG file';
  if (size.width !== LOGO_SIZE || size.height !== LOGO_SIZE) {
    return `the logo is ${size.width}×${size.height}, not ${LOGO_SIZE}×${LOGO_SIZE}`;
  }
  return bytes.length > MAX_LOGO_BYTES ? 'the logo is over 5 MB' : null;
}

const MetaErrorSchema = z.object({
  error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }),
});
const SessionSchema = z.object({ id: z.string().startsWith('upload:') });
const HandleSchema = z.object({ h: z.string().min(1) });
const UpdatedSchema = z.object({ success: z.literal(true) });
const ProfileSchema = z.object({
  data: z
    .array(
      z.object({
        about: z.string().optional(),
        description: z.string().optional(),
        vertical: z.string().optional(),
        websites: z.array(z.string()).optional(),
        profile_picture_url: z.string().optional(),
      }),
    )
    .min(1),
});

/** A Meta failure: status and code only, never Meta's message (it can quote ids or tokens). */
export class MetaStepError extends Error {
  override name = 'MetaStepError';
}

async function failureOf(step: string, response: Response): Promise<MetaStepError> {
  const parsed = MetaErrorSchema.safeParse(await response.json().catch(() => null));
  const code = parsed.success
    ? ` code ${parsed.data.error.code ?? '-'} subcode ${parsed.data.error.error_subcode ?? '-'}`
    : '';
  return new MetaStepError(`${step}: HTTP ${response.status}${code}`);
}

export interface ProfileRun {
  readonly fetchImpl: typeof fetch;
  readonly token: string;
  readonly phoneNumberId: string;
  readonly appId: string;
  readonly png: Uint8Array<ArrayBuffer>;
  readonly text: ProfileText;
}

async function call<T>(
  step: string,
  request: { url: string; init: RequestInit; schema: z.ZodType<T> },
  run: ProfileRun,
): Promise<T> {
  const response = await run.fetchImpl(request.url, request.init);
  if (!response.ok) throw await failureOf(step, response);
  const parsed = request.schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MetaStepError(`${step}: unexpected reply`);
  return parsed.data;
}

function bearer(run: ProfileRun): Record<string, string> {
  return { authorization: `Bearer ${run.token}` };
}

/** Steps 1 and 2: the PNG goes up once and comes back as a handle for the profile. */
async function uploadLogo(run: ProfileRun): Promise<string> {
  const query = new URLSearchParams({
    file_name: LOGO_FILE_NAME,
    file_length: String(run.png.byteLength),
    file_type: 'image/png',
  });
  const session = await call(
    'upload session',
    {
      url: `${GRAPH_API_BASE}/${run.appId}/uploads?${query.toString()}`,
      init: { method: 'POST', headers: bearer(run) },
      schema: SessionSchema,
    },
    run,
  );
  const uploaded = await call(
    'upload',
    {
      url: `${GRAPH_API_BASE}/${session.id}`,
      init: {
        method: 'POST',
        headers: { authorization: `OAuth ${run.token}`, file_offset: '0' },
        body: run.png,
      },
      schema: HandleSchema,
    },
    run,
  );
  return uploaded.h;
}

/** The step-3 request body (also what the dry run prints, without the handle). */
export function profilePayload(text: ProfileText, handle: string | null): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    ...text,
    ...(handle ? { profile_picture_handle: handle } : {}),
  };
}

const PROFILE_FIELDS = 'about,description,vertical,websites,profile_picture_url';

/** Runs the four steps; returns what Meta now has. Throws MetaStepError on any failure. */
export async function setBotProfile(run: ProfileRun): Promise<z.infer<typeof ProfileSchema>> {
  const handle = await uploadLogo(run);
  const profileUrl = `${GRAPH_API_BASE}/${run.phoneNumberId}/whatsapp_business_profile`;
  await call(
    'profile update',
    {
      url: profileUrl,
      init: {
        method: 'POST',
        headers: { ...bearer(run), 'content-type': 'application/json' },
        body: JSON.stringify(profilePayload(run.text, handle)),
      },
      schema: UpdatedSchema,
    },
    run,
  );
  return await call(
    'profile read',
    {
      url: `${profileUrl}?fields=${PROFILE_FIELDS}`,
      init: { method: 'GET', headers: bearer(run) },
      schema: ProfileSchema,
    },
    run,
  );
}
