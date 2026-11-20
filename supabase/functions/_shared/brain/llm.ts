// supabase/functions/_shared/brain/llm.ts
// The LLM step of the brain (ADR-0014, M4 Decision 3): the shared Sarvam → Gemini JSON call
// (`_shared/llm/json-llm.ts`) with the brain prompt and SuggestionSchema. If both providers fail,
// the caller says "Sorry, I didn't get that" + help.
import { createJsonLlm, type JsonLlmConfig, type LlmPath } from '../llm/json-llm.ts';
import { buildBrainPrompt } from './prompt.ts';
import { parseSuggestion, type Suggestion } from './suggestion.ts';

export type { LlmPath } from '../llm/json-llm.ts';

export interface LlmResult {
  readonly suggestion: Suggestion | null;
  readonly path: LlmPath;
}

export type BrainLlmConfig = JsonLlmConfig;

export type BrainLlm = (message: string, now: Date) => Promise<LlmResult>;

export function createBrainLlm(config: BrainLlmConfig): BrainLlm {
  const askJson = createJsonLlm(config);
  return async function suggest(message, now): Promise<LlmResult> {
    const answer = await askJson({
      event: 'brain_llm',
      system: buildBrainPrompt(now),
      message,
      parse: parseSuggestion,
    });
    return { suggestion: answer.value, path: answer.path };
  };
}
