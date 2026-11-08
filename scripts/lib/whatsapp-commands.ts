// scripts/lib/whatsapp-commands.ts
// The WhatsApp "/" commands (2026-11-08) set on the Meta number, so they show in WhatsApp's "/"
// menu: one POST {graph}/{phone number id}/conversational_automation with `commands` =
// [{ command_name, command_description }]. The list is the router's own (slash-commands.ts), so
// what is registered is exactly what the bot answers. Names go without the slash; descriptions
// are English, at most 256 characters (checked with Zod before anything is sent). The token goes
// in a header, never in a URL; errors carry the HTTP status and Meta's codes only.
import { z } from 'zod';
import { GRAPH_API_BASE } from '../../supabase/functions/_shared/whatsapp/client.ts';
import {
  MAX_COMMAND_DESCRIPTION,
  MAX_COMMAND_NAME,
  MAX_COMMANDS,
  SLASH_COMMANDS,
} from '../../supabase/functions/_shared/whatsapp/slash-commands.ts';
import { failureOf, MetaStepError } from './bot-profile.ts';

export const CommandsPayloadSchema = z.object({
  commands: z
    .array(
      z.object({
        command_name: z
          .string()
          .regex(/^[a-z]+$/)
          .max(MAX_COMMAND_NAME),
        command_description: z.string().min(1).max(MAX_COMMAND_DESCRIPTION),
      }),
    )
    .min(1)
    .max(MAX_COMMANDS),
});
export type CommandsPayload = z.infer<typeof CommandsPayloadSchema>;

const UpdatedSchema = z.object({ success: z.literal(true) });

/** The request body (also what --dry prints). */
export function commandsPayload(): CommandsPayload {
  return CommandsPayloadSchema.parse({
    commands: SLASH_COMMANDS.map((command) => ({
      command_name: command.name,
      command_description: command.description,
    })),
  });
}

export function commandsUrl(phoneNumberId: string): string {
  return `${GRAPH_API_BASE}/${phoneNumberId}/conversational_automation`;
}

export interface CommandsRun {
  readonly fetchImpl: typeof fetch;
  readonly token: string;
  readonly phoneNumberId: string;
}

/** Sets the commands. Throws MetaStepError on any failure. */
export async function registerCommands(run: CommandsRun): Promise<void> {
  const response = await run.fetchImpl(commandsUrl(run.phoneNumberId), {
    method: 'POST',
    headers: { authorization: `Bearer ${run.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commandsPayload()),
  });
  if (!response.ok) throw await failureOf('commands', response);
  const parsed = UpdatedSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MetaStepError('commands: unexpected reply');
}
