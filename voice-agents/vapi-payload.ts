// voice-agents/vapi-payload.ts
// Turns an agent config into Vapi's assistant format. Shared by the push script (full
// assistant) and the browser (per-call language overrides) so both use one definition.
import { VAPI_SECRET_HEADER } from '../supabase/functions/_shared/vapi.ts';
import { REGION_HEADER } from '../supabase/functions/_shared/region.ts';
import type { AgentConfig, FunctionTool } from './schema.ts';
import type { VariantId } from './collections/language-settings.ts';

const SILENCE_TIMEOUT_SECONDS = 20;
const MAX_IDLE_PROMPTS = 1;
/** Vapi's documented silence event; the old messagePlan.idleMessages is ignored in overrides
 * (voice test: a Hindi call spoke the English idle line). */
const SILENCE_HOOK_EVENT = 'customer.speech.timeout';
const MODEL_TEMPERATURE = 0.4;
/** Our tools answer in well under a second; fail fast rather than leave the caller in silence. */
const TOOL_SERVER_TIMEOUT_SECONDS = 10;
/** Vapi's built-in hang-up tool: lets Asha end the call (wrong person, verification failed). */
const END_CALL_TOOL = { type: 'endCall' } as const;
/** Only tool calls go to our server in M2; end-of-call reports are added in M4. */
const SERVER_MESSAGES = ['tool-calls'] as const;

export interface IdleHook {
  readonly name: string;
  readonly on: typeof SILENCE_HOOK_EVENT;
  readonly options: {
    readonly timeoutSeconds: number;
    readonly triggerMaxCount: number;
    readonly triggerResetMode: 'never';
  };
  readonly do: readonly { readonly type: 'say'; readonly exact: readonly string[] }[];
}

export interface VariantOverrides {
  readonly transcriber: AgentConfig['variants']['en']['transcriber'];
  readonly voice: AgentConfig['variants']['en']['voice'];
  readonly firstMessage: string;
  readonly endCallMessage: string;
  /** Per-language idle prompt, sent with every call so the right language always wins. */
  readonly hooks: readonly IdleHook[];
  readonly startSpeakingPlan: {
    readonly transcriptionEndpointingPlan: { readonly onNoPunctuationSeconds: number };
  };
}

/** What the browser gets from POST /v1/calls/authorize and passes into the call. */
export interface CallDetails {
  readonly callToken: string;
  readonly customerName: string;
  /** India date label from the demo-aware server clock, e.g. "Sunday, 2026-11-01". */
  readonly today: string;
}

export interface CallOverrides extends VariantOverrides {
  /** The webhook resolves the customer from this token, never from the LLM. */
  readonly metadata: { readonly callToken: string };
  /** Fills {{customerName}}, {{today}} and the variant's prompt variables. */
  readonly variableValues: Readonly<Record<string, string>> & {
    readonly customerName: string;
    readonly today: string;
  };
}

export interface AssistantPayload extends VariantOverrides {
  readonly name: string;
  readonly model: {
    readonly provider: AgentConfig['model']['provider'];
    readonly model: AgentConfig['model']['model'];
    readonly temperature: number;
    readonly messages: readonly { readonly role: 'system'; readonly content: string }[];
    readonly tools: readonly (FunctionTool | typeof END_CALL_TOOL)[];
  };
  /** Cleared so the old English idle line stored on the assistant can never fire. */
  readonly messagePlan: { readonly idleMessages: readonly string[] };
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
    hooks: [
      {
        name: `idle_${variantId}`,
        on: SILENCE_HOOK_EVENT,
        options: {
          timeoutSeconds: config.idleTimeoutSeconds,
          triggerMaxCount: MAX_IDLE_PROMPTS,
          triggerResetMode: 'never',
        },
        do: [{ type: 'say', exact: [variant.idleMessage] }],
      },
    ],
    startSpeakingPlan: {
      transcriptionEndpointingPlan: { onNoPunctuationSeconds: variant.endOfSpeechWaitSeconds },
    },
  };
}

export function buildCallOverrides(
  config: AgentConfig,
  variantId: VariantId,
  call: CallDetails,
): CallOverrides {
  return {
    ...buildVariantOverrides(config, variantId),
    metadata: { callToken: call.callToken },
    variableValues: {
      ...config.variants[variantId].promptVariables,
      customerName: call.customerName,
      today: call.today,
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
      tools: [...config.tools, END_CALL_TOOL],
    },
    ...buildVariantOverrides(config, config.defaultVariant),
    messagePlan: { idleMessages: [] },
    stopSpeakingPlan: config.interruption,
    silenceTimeoutSeconds: SILENCE_TIMEOUT_SECONDS,
    maxDurationSeconds: config.maxDurationSeconds,
  };
}

export interface ToolServer {
  /** The deployed vapi-webhook function URL. */
  readonly url: string;
  readonly secret: string;
  /** Supabase region to run the webhook in: the database's, not the one nearest Vapi. */
  readonly region: string;
}

export interface ServerSettings {
  readonly server: {
    readonly url: string;
    readonly timeoutSeconds: number;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly serverMessages: readonly (typeof SERVER_MESSAGES)[number][];
}

/** Where Vapi sends tool calls. Built by the push script only, so the secret stays out of the
 * repo and out of the browser bundle. */
export function buildServerSettings(toolServer: ToolServer): ServerSettings {
  return {
    server: {
      url: toolServer.url,
      timeoutSeconds: TOOL_SERVER_TIMEOUT_SECONDS,
      headers: { [VAPI_SECRET_HEADER]: toolServer.secret, [REGION_HEADER]: toolServer.region },
    },
    serverMessages: [...SERVER_MESSAGES],
  };
}
