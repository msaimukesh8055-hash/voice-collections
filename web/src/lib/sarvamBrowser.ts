// web/src/lib/sarvamBrowser.ts
// The real AgentFactory: creates the Sarvam SDK agent with the browser's mic and speaker.
// Kept apart from sarvamClient.ts so tests never load the SDK (it needs AudioWorklet).
// apiKey is empty on purpose: the SDK asks our calls-api proxy for the call URL, and the proxy
// adds the key server-side (spike, M3 Results).
import {
  BrowserAudioInterface,
  ConversationAgent,
  InteractionType,
  type InteractionConfig,
} from 'sarvam-conv-ai-sdk/browser';
import type {
  AgentCallbacks,
  AgentHandle,
  AgentRequest,
  SdkRole,
  SdkState,
} from './sarvamClient.ts';

const SAMPLE_RATE = 16000;

/** The SDK's language enum is not exported from its browser entry; this is its type. */
type SdkLanguageName = NonNullable<InteractionConfig['initial_language_name']>;

export function createBrowserAgent(request: AgentRequest, callbacks: AgentCallbacks): AgentHandle {
  const agent = new ConversationAgent({
    apiKey: '',
    baseUrl: request.proxy.baseUrl,
    customHeaders: { ...request.proxy.headers },
    config: {
      org_id: request.orgId,
      workspace_id: request.workspaceId,
      app_id: request.appId,
      user_identifier: request.userIdentifier,
      user_identifier_type: 'custom',
      interaction_type: InteractionType.CALL,
      input_sample_rate: SAMPLE_RATE,
      output_sample_rate: SAMPLE_RATE,
      agent_variables: { ...request.variables },
      // The SDK exports this enum as a type only; its values are these same language names.
      initial_language_name: request.languageName as SdkLanguageName,
      initial_bot_message: request.greeting,
    },
    audioInterface: new BrowserAudioInterface(),
    async transcriptCallback(message) {
      const role: SdkRole = `${message.role}`;
      callbacks.onTranscript(role, message.content);
    },
    stateCallback(state) {
      const name: SdkState = `${state}`;
      callbacks.onState(name);
    },
    audioLevelCallback(level) {
      if (level.direction === 'input') callbacks.onInputLevel(level.rms);
    },
    // Sarvam's own speech detection (user_speech_start / _end / user_interrupt): the first source
    // for the person's arrow on the call screen (M7 B2); the mic level stays as the fallback.
    async eventCallback(event) {
      callbacks.onServerEvent(`${event.type}`);
    },
    async endCallback() {
      callbacks.onEnd();
    },
  });
  return {
    start: () => agent.start(),
    waitForConnect: (timeoutSeconds) => agent.waitForConnect(timeoutSeconds),
    stop: () => agent.stop(),
    getInteractionId: () => agent.getInteractionId(),
  };
}
