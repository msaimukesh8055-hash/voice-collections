// scripts/lib/bot-profile.test.ts
// The bot profile script's library over a fake fetch (M7 A2): PNG checks, the texts schema, the
// four Meta steps in order with the right headers, Meta errors as codes only, the token never in
// any URL or message, and the committed logo PNG being 640×640. No network.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABOUT,
  DESCRIPTION,
  LOGO_SIZE,
  logoProblem,
  MAX_LOGO_BYTES,
  MetaStepError,
  pngSize,
  profilePayload,
  profileText,
  ProfileTextSchema,
  type ProfileRun,
  setBotProfile,
} from './bot-profile.ts';

const TOKEN = 'FAKE-TOKEN-never-printed';
const GRAPH = 'https://graph.facebook.com/v25.0';

/** A PNG header (signature + IHDR) of the given size; the rest of the file does not matter. */
function fakePng(width: number, height: number, length = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

interface Seen {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Fresh replies per test (a Response body can be read only once). */
function goodReplies(): Response[] {
  return [
    json({ id: 'upload:SESSION1?sig=abc' }),
    json({ h: 'HANDLE1' }),
    json({ success: true }),
    json({ data: [{ about: ABOUT, profile_picture_url: 'https://cdn.example/p.png' }] }),
  ];
}

function fakeRun(replies: Response[]): { run: ProfileRun; seen: Seen[] } {
  const seen: Seen[] = [];
  const queue = [...replies];
  const fetchImpl: typeof fetch = (url, init) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(queue.shift() ?? json({}, 500));
  };
  const run: ProfileRun = {
    fetchImpl,
    token: TOKEN,
    phoneNumberId: '100000000000001',
    appId: '200000000000002',
    png: fakePng(LOGO_SIZE, LOGO_SIZE),
    text: profileText('https://voice-collections.example'),
  };
  return { run, seen };
}

function headersOf(seen: Seen | undefined): Record<string, string> {
  return (seen?.init?.headers ?? {}) as Record<string, string>;
}

describe('pngSize / logoProblem', () => {
  it('reads width and height from the header', () => {
    expect(pngSize(fakePng(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('refuses a file that is not a PNG, the wrong size, or too big', () => {
    expect(logoProblem(new Uint8Array([1, 2, 3]))).toBe('the logo is not a PNG file');
    expect(logoProblem(fakePng(640, 640).slice(0, 20))).toBe('the logo is not a PNG file');
    expect(logoProblem(fakePng(512, 512))).toBe('the logo is 512×512, not 640×640');
    expect(logoProblem(fakePng(640, 640, MAX_LOGO_BYTES + 1))).toBe('the logo is over 5 MB');
    expect(logoProblem(fakePng(640, 640))).toBeNull();
  });

  it('the committed logo PNG (npm run brand:png) is 640×640', () => {
    const png = new Uint8Array(readFileSync('web/public/brand/logo-640.png'));
    expect(pngSize(png)).toEqual({ width: 640, height: 640 });
    expect(logoProblem(png)).toBeNull();
  });
});

describe('profile texts', () => {
  it('About, description and category fit Meta; https website only', () => {
    expect(ABOUT.length).toBeLessThanOrEqual(139);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(profileText('https://x.example').websites).toEqual(['https://x.example']);
    expect(profileText('http://localhost:5173').websites).toEqual([]);
    expect(profileText(null)).toMatchObject({ about: ABOUT, vertical: 'FINANCE' });
  });

  it('refuses a 140-character About and an unknown category', () => {
    const base = profileText(null);
    expect(ProfileTextSchema.safeParse({ ...base, about: 'a'.repeat(140) }).success).toBe(false);
    expect(ProfileTextSchema.safeParse({ ...base, vertical: 'BANKING' }).success).toBe(false);
    expect(ProfileTextSchema.safeParse({ ...base, websites: ['http://x.example'] }).success).toBe(
      false,
    );
  });

  it('the dry-run payload has no picture handle', () => {
    expect(profilePayload(profileText(null), null)).toEqual({
      messaging_product: 'whatsapp',
      about: ABOUT,
      description: DESCRIPTION,
      vertical: 'FINANCE',
      websites: [],
    });
  });
});

describe('setBotProfile', () => {
  it('runs the four steps in order with the right URLs and headers', async () => {
    const { run, seen } = fakeRun(goodReplies());
    const profile = await setBotProfile(run);
    expect(seen.map((each) => [each.init?.method, each.url])).toEqual([
      [
        'POST',
        `${GRAPH}/200000000000002/uploads?file_name=logo-640.png&file_length=64&file_type=image%2Fpng`,
      ],
      ['POST', `${GRAPH}/upload:SESSION1?sig=abc`],
      ['POST', `${GRAPH}/100000000000001/whatsapp_business_profile`],
      [
        'GET',
        `${GRAPH}/100000000000001/whatsapp_business_profile?fields=about,description,vertical,websites,profile_picture_url`,
      ],
    ]);
    expect(headersOf(seen[0]).authorization).toBe(`Bearer ${TOKEN}`);
    expect(headersOf(seen[1])).toEqual({ authorization: `OAuth ${TOKEN}`, file_offset: '0' });
    expect(seen[1]?.init?.body).toBe(run.png);
    expect(JSON.parse(String(seen[2]?.init?.body))).toEqual({
      ...profilePayload(run.text, null),
      profile_picture_handle: 'HANDLE1',
    });
    expect(profile.data[0]?.profile_picture_url).toBe('https://cdn.example/p.png');
  });

  it('the token is never in a URL', async () => {
    const { run, seen } = fakeRun(goodReplies());
    await setBotProfile(run);
    expect(seen.some((each) => each.url.includes(TOKEN))).toBe(false);
  });

  it('a Meta error stops at that step with status and code only', async () => {
    const refused = json({ error: { message: `bad ${TOKEN}`, code: 100, error_subcode: 33 } }, 400);
    const { run, seen } = fakeRun([...goodReplies().slice(0, 2), refused]);
    const failure = await setBotProfile(run).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MetaStepError);
    expect((failure as Error).message).toBe('profile update: HTTP 400 code 100 subcode 33');
    expect((failure as Error).message.includes(TOKEN)).toBe(false);
    expect(seen.length).toBe(3);
  });

  it('an error body that is not JSON, or an unexpected reply, is reported plainly', async () => {
    const { run } = fakeRun([new Response('nope', { status: 502 })]);
    await expect(setBotProfile(run)).rejects.toThrow('upload session: HTTP 502');
    const odd = fakeRun([json({ id: 'not-a-session' })]);
    await expect(setBotProfile(odd.run)).rejects.toThrow('upload session: unexpected reply');
    const noCode = fakeRun([json({ error: {} }, 403)]);
    await expect(setBotProfile(noCode.run)).rejects.toThrow(
      'upload session: HTTP 403 code - subcode -',
    );
    const notJson = fakeRun([new Response('<html>', { status: 200 })]);
    await expect(setBotProfile(notJson.run)).rejects.toThrow('unexpected reply');
  });
});
