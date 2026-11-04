// supabase/functions/_shared/simulator/moves.ts
// What each side of a simulated call may answer, checked with Zod (LLM output is never trusted):
//   Asha:       {"say": "...", "tool": null | {"name": "...", "args": {...}}, "end_call": false}
//   shopkeeper: {"say": "...", "hang_up": false}
// A missing optional field takes its safe default; an answer with nothing to say and no tool is
// unusable (null). Texts are cut to the transcript's per-turn limit. sarvam-105b sometimes drops
// the JSON after a tool reply and just talks: plain words with no JSON in them are what she says.
import { z } from 'zod';
import { extractJson } from '../llm/json-llm.ts';
import { MAX_TURN_CHARS } from '../sarvam-analytics.ts';

const MAX_TOOL_NAME = 60;

const Spoken = z.string().trim().transform((text) => text.slice(0, MAX_TURN_CHARS));

const AshaMoveSchema = z.object({
  say: Spoken.catch(''),
  tool: z.object({
    name: z.string().trim().min(1).max(MAX_TOOL_NAME),
    args: z.record(z.string(), z.unknown()).catch({}),
  }).nullable().catch(null),
  end_call: z.boolean().catch(false),
});

const ShopkeeperMoveSchema = z.object({
  say: Spoken.pipe(z.string().min(1)),
  hang_up: z.boolean().catch(false),
});

export type AshaMove = z.infer<typeof AshaMoveSchema>;
export type ShopkeeperMove = z.infer<typeof ShopkeeperMoveSchema>;

function plainSpeech(content: string): AshaMove | null {
  const say = content.trim().slice(0, MAX_TURN_CHARS);
  return say === '' || say.includes('{') ? null : { say, tool: null, end_call: false };
}

export function parseAshaMove(content: string): AshaMove | null {
  const move = extractJson(content, AshaMoveSchema) ?? plainSpeech(content);
  if (!move || (move.say === '' && move.tool === null)) return null;
  return move;
}

export function parseShopkeeperMove(content: string): ShopkeeperMove | null {
  return extractJson(content, ShopkeeperMoveSchema);
}
