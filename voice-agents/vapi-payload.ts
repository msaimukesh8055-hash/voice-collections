// voice-agents/vapi-payload.ts
// Turns an agent config into Vapi's assistant format. Shared by the push script (full
// assistant) and the browser (per-call language overrides) so both use one definition.
import type { AgentConfig } from './schema.ts';
import type { VariantId } from './collections/language-settings.ts';

const SILENCE_TIMEOUT_SECONDS = 20;
const MAX_IDLE_PROMPTS = 1;
const MODEL_TEMPERATURE = 0.4;

export interface VariantOverrides {
  readonly transcriber: AgentConfig['variants']['en']['transcriber'];
  readonly voice: AgentConfig['variants']['en']['voice'];
  readonly firstMessage: string;
  readonly endCallMessage: string;
  readonly messagePlan: {
    readonly idleMessages: readonly string[];
    readonly idleTimeoutSeconds: number;
    readonly idleMessageMaxSpokenCount: number;
  };
  readonly startSpeakingPlan: {
    readonly transcriptionEndpointingPlan: { readonly onNoPunctuationSeconds: number };
  };
}

export interface AssistantPayload extends VariantOverrides {
  readonly name: string;
  readonly model: {
    readonly provider: AgentConfig['model']['provider'];
    readonly model: AgentConfig['model']['model'];
    readonly temperature: number;
    readonly messages: readonly { readonly role: 'system'; readonly content: string }[];
  };
  readonly stopSpeakingPlan: AgentConfig['interruption'];
  readonly silenceTimeoutSeconds: number;
  readonly maxDurationSeconds: number;
}

export function buildVariantOverrides(config: AgentConfig, variantId: VariantId): VariantOverrides {
  const variant = config.variants[variantId];
  return {
    transcriber: variant.transcriber,
    voice: variant.voice,
    firstMessage: variant.firstMessage,
    endCallMessage: variant.endCallMessage,
    messagePlan: {
      idleMessages: [variant.idleMessage],
      idleTimeoutSeconds: config.idleTimeoutSeconds,
      idleMessageMaxSpokenCount: MAX_IDLE_PROMPTS,
    },
    startSpeakingPlan: {
      transcriptionEndpointingPlan: { onNoPunctuationSeconds: variant.endOfSpeechWaitSeconds },
    },
  };
}

export function buildAssistantPayload(config: AgentConfig): AssistantPayload {
  return {
    name: config.name,
    model: {
      provider: config.model.provider,
      model: config.model.model,
      temperature: MODEL_TEMPERATURE,
      messages: [{ role: 'system', content: config.systemPrompt }],
    },
    ...buildVariantOverrides(config, config.defaultVariant),
    stopSpeakingPlan: config.interruption,
    silenceTimeoutSeconds: SILENCE_TIMEOUT_SECONDS,
    maxDurationSeconds: config.maxDurationSeconds,
  };
}
