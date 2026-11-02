// voice-agents/asha/banned-words.ts
// Threat and shaming words Asha must never use, at any tone level (SPEC §7.4, §10). Checked
// against the prompt now and against call transcripts by the evals in M7.
export const BANNED_WORDS = [
  'police',
  'court',
  'jail',
  'arrest',
  'legal action',
  'lawyer',
  'seize',
  'blacklist',
  'cheat',
  'fraud',
  'shameful',
] as const;

export function findBannedWords(text: string): readonly string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((word) => lower.includes(word));
}
