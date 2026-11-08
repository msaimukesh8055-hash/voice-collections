// scripts/lib/whatsapp-commands.test.ts
// The "/" command registration (2026-11-08) over a fake fetch: the payload is the router's own
// command list (names without the slash, English descriptions within Meta's limits), one POST to
// conversational_automation with the token in a header only, Meta errors as codes only. No
// network.
import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS } from '../../supabase/functions/_shared/whatsapp/slash-commands.ts';
import { MetaStepError } from './bot-profile.ts';
import {
  commandsPayload,
  CommandsPayloadSchema,
  commandsUrl,
  registerCommands,
} from './whatsapp-commands.ts';

const TOKEN = 'FAKE-TOKEN-never-printed';
const PHONE_ID = '123456789012345';

interface Seen {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(reply: Response): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(reply);
  };
  return { fetchImpl, seen };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('commandsPayload', () => {
  it('lists every router command, without the slash, in order', () => {
    const payload = commandsPayload();
    expect(payload.commands.map((command) => command.command_name)).toEqual([
      'munshi',
      'menu',
      'pending',
      'due',
      'overdue',
      'paid',
      'add',
      'asha',
      'reminder',
      'claims',
      'promises',
      'insights',
      'statement',
    ]);
    expect(payload.commands.map((command) => command.command_description)).toEqual(
      SLASH_COMMANDS.map((command) => command.description),
    );
  });

  it("fits Meta's limits", () => {
    const payload = commandsPayload();
    expect(CommandsPayloadSchema.parse(payload)).toEqual(payload);
    for (const command of payload.commands) {
      expect(command.command_name).toMatch(/^[a-z]{1,32}$/);
      expect(command.command_description.length).toBeLessThanOrEqual(256);
    }
  });

  it('refuses a name with a slash or a description over 256 characters', () => {
    const bad = (name: string, description: string): boolean =>
      CommandsPayloadSchema.safeParse({
        commands: [{ command_name: name, command_description: description }],
      }).success;
    expect(bad('/paid', 'x')).toBe(false);
    expect(bad('paid', 'x'.repeat(257))).toBe(false);
    expect(bad('paid', '')).toBe(false);
    expect(bad('paid', 'x'.repeat(256))).toBe(true);
  });
});

describe('registerCommands', () => {
  it('posts the payload as JSON to conversational_automation, token in a header only', async () => {
    const { fetchImpl, seen } = fakeFetch(json({ success: true }));
    await registerCommands({ fetchImpl, token: TOKEN, phoneNumberId: PHONE_ID });
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.url).toBe(
      `https://graph.facebook.com/v25.0/${PHONE_ID}/conversational_automation`,
    );
    expect(commandsUrl(PHONE_ID)).toBe(request?.url);
    expect(request?.url).not.toContain(TOKEN);
    expect(request?.init?.method).toBe('POST');
    expect(request?.init?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(request?.init?.body))).toEqual(commandsPayload());
  });

  it("a Meta error throws its status and codes only, never Meta's message or the token", async () => {
    const reply = json(
      { error: { message: `bad token ${TOKEN}`, code: 100, error_subcode: 33 } },
      400,
    );
    const { fetchImpl } = fakeFetch(reply);
    const error: unknown = await registerCommands({
      fetchImpl,
      token: TOKEN,
      phoneNumberId: PHONE_ID,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaStepError);
    expect(error instanceof Error ? error.message : '').toBe(
      'commands: HTTP 400 code 100 subcode 33',
    );
  });

  it('a reply that is not JSON throws', async () => {
    const { fetchImpl } = fakeFetch(new Response('<html>', { status: 200 }));
    await expect(
      registerCommands({ fetchImpl, token: TOKEN, phoneNumberId: PHONE_ID }),
    ).rejects.toThrow('commands: unexpected reply');
  });

  it('an unexpected reply throws', async () => {
    const { fetchImpl } = fakeFetch(json({ ok: 'maybe' }));
    await expect(
      registerCommands({ fetchImpl, token: TOKEN, phoneNumberId: PHONE_ID }),
    ).rejects.toThrow('commands: unexpected reply');
  });
});
