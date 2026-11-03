// supabase/functions/_shared/followup/__fixtures__/fake-llm.ts
// A fake JsonLlm (testing.md: no real LLM in unit tests). Each answer is the raw text a provider
// "returned"; the caller's parser decides whether it is usable, exactly as with the real one.
import type { JsonAnswer, JsonLlm, JsonRequest, LlmProvider } from '../../llm/json-llm.ts';

export interface FakeLlmCall {
  readonly event: string;
  readonly system: string;
  readonly message: string;
}

/** `answers[event]` = what Sarvam then Gemini return for that event; missing → both fail. */
export function fakeLlm(
  answers: Readonly<Record<string, readonly (string | null)[]>> = {},
): { readonly llm: JsonLlm; readonly calls: FakeLlmCall[] } {
  const calls: FakeLlmCall[] = [];
  const providers: readonly LlmProvider[] = ['sarvam', 'gemini'];
  function askJson<T>(request: JsonRequest<T>): Promise<JsonAnswer<T>> {
    calls.push({ event: request.event, system: request.system, message: request.message });
    const texts = answers[request.event] ?? [];
    for (const [index, provider] of providers.entries()) {
      const text = texts[index];
      const value = text === undefined || text === null ? null : request.parse(text);
      if (value !== null) return Promise.resolve({ value, path: provider });
    }
    return Promise.resolve({ value: null, path: 'failed' });
  }
  return { llm: askJson, calls };
}
