// voice-agents/munshi/greetings.ts
// Munshi's first line (M8, approved by Saim 2026-11-07): always Telugu, casual, the owner's first
// name; Munshi then follows the language the owner speaks. No figures in it.
// ⚠️ Telugu wording to be checked by a native speaker before the demo.
//
// హా {{owner_short_name}} అన్నా, మున్షీని. చెప్పండి, ఏం చూడాలి?
//
// "Hi {{owner_short_name}} anna, it's Munshi. Tell me, what shall I look at?"

/** {{owner_short_name}} is a Sarvam agent variable; renderMunshiGreeting fills it for the page. */
export const MUNSHI_GREETING = 'హా {{owner_short_name}} అన్నా, మున్షీని. చెప్పండి, ఏం చూడాలి?';

export function renderMunshiGreeting(ownerShortName: string): string {
  return MUNSHI_GREETING.replace(/\{\{owner_short_name\}\}/g, function fill(): string {
    return ownerShortName;
  });
}
