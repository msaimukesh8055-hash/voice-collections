// web/src/features/voice-spike/VoiceSpikePage.tsx
// M1 voice spike: start a browser call in a chosen language and watch the live transcript.
// Replaced by the full call simulator in M5.
import { useEffect, useState, type ChangeEvent } from 'react';
import { collectionsAgent } from '@agent/collections/assistant.config.ts';
import { VARIANT_IDS, type VariantId } from '@agent/collections/language-settings.ts';
import { buildVariantOverrides } from '@agent/vapi-payload.ts';
import type { CallStatus, TranscriptLine, VoiceClient } from '../../lib/vapiClient.ts';

const STATUS_LABEL: Readonly<Record<CallStatus, string>> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  live: 'Live',
  ended: 'Call ended',
  error: 'Error',
};

interface CallState {
  readonly status: CallStatus;
  readonly transcript: readonly TranscriptLine[];
  readonly agentSpeaking: boolean;
  readonly error: string | null;
}

const INITIAL_STATE: CallState = {
  status: 'idle',
  transcript: [],
  agentSpeaking: false,
  error: null,
};

function isVariantId(value: string): value is VariantId {
  return (VARIANT_IDS as readonly string[]).includes(value);
}

function useVoiceCall(
  client: VoiceClient,
): CallState & { setState: (next: Partial<CallState>) => void } {
  const [state, setFullState] = useState<CallState>(INITIAL_STATE);

  function setState(next: Partial<CallState>): void {
    setFullState(function merge(previous) {
      return { ...previous, ...next };
    });
  }

  useEffect(
    function subscribeToCall() {
      return client.subscribe({
        onStatus: function handleStatus(status) {
          setFullState(function applyStatus(previous) {
            return { ...previous, status };
          });
        },
        onTranscript: function handleTranscript(line) {
          setFullState(function appendLine(previous) {
            return { ...previous, transcript: [...previous.transcript, line] };
          });
        },
        onAgentSpeaking: function handleSpeaking(agentSpeaking) {
          setFullState(function applySpeaking(previous) {
            return { ...previous, agentSpeaking };
          });
        },
        onError: function handleError(error) {
          setFullState(function applyError(previous) {
            return { ...previous, status: 'error', error };
          });
        },
      });
    },
    [client],
  );

  return { ...state, setState };
}

export function VoiceSpikePage({ client }: { readonly client: VoiceClient }): React.JSX.Element {
  const [variantId, setVariantId] = useState<VariantId>(collectionsAgent.defaultVariant);
  const call = useVoiceCall(client);
  const inCall = call.status === 'connecting' || call.status === 'live';

  function handleVariantChange(event: ChangeEvent<HTMLInputElement>): void {
    if (isVariantId(event.target.value)) setVariantId(event.target.value);
  }

  async function handleStart(): Promise<void> {
    call.setState({ ...INITIAL_STATE, status: 'connecting' });
    try {
      await client.start(buildVariantOverrides(collectionsAgent, variantId));
    } catch {
      call.setState({
        status: 'error',
        error: 'Could not start the call. Allow microphone access and retry.',
      });
    }
  }

  async function handleStop(): Promise<void> {
    await client.stop();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-brand">M1 · Voice spike</p>
        <h1 className="text-3xl font-semibold">Test call — Suvidha Finance assistant</h1>
      </header>
      <LanguagePicker selected={variantId} disabled={inCall} onChange={handleVariantChange} />
      <CallControls inCall={inCall} onStart={handleStart} onStop={handleStop}>
        <StatusBadge status={call.status} agentSpeaking={call.agentSpeaking} />
      </CallControls>
      {call.error ? <ErrorBanner message={call.error} /> : null}
      <Transcript lines={call.transcript} />
    </main>
  );
}

interface CallControlsProps {
  readonly inCall: boolean;
  readonly onStart: () => Promise<void>;
  readonly onStop: () => Promise<void>;
  readonly children: React.ReactNode;
}

function CallControls({ inCall, onStart, onStop, children }: CallControlsProps): React.JSX.Element {
  return (
    <section className="flex items-center gap-3">
      <button
        type="button"
        onClick={onStart}
        disabled={inCall}
        className="rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-strong disabled:opacity-40"
      >
        Start call
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!inCall}
        className="rounded-lg border border-border bg-surface px-5 py-2.5 font-medium disabled:opacity-40"
      >
        End call
      </button>
      {children}
    </section>
  );
}

function ErrorBanner({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-surface px-4 py-3 text-danger">
      {message}
    </p>
  );
}

interface LanguagePickerProps {
  readonly selected: VariantId;
  readonly disabled: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function LanguagePicker({ selected, disabled, onChange }: LanguagePickerProps): React.JSX.Element {
  function renderOption(id: VariantId): React.JSX.Element {
    return (
      <label
        key={id}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2"
      >
        <input
          type="radio"
          name="variant"
          value={id}
          checked={selected === id}
          disabled={disabled}
          onChange={onChange}
        />
        {collectionsAgent.variants[id].label}
      </label>
    );
  }
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="mb-2 text-sm font-medium text-ink-muted">Language</legend>
      {VARIANT_IDS.map(renderOption)}
    </fieldset>
  );
}

function StatusBadge({
  status,
  agentSpeaking,
}: {
  readonly status: CallStatus;
  readonly agentSpeaking: boolean;
}): React.JSX.Element {
  const speakingLabel =
    status === 'live' ? (agentSpeaking ? ' · Asha speaking' : ' · Listening') : '';
  return (
    <span
      data-testid="call-status"
      className="ml-auto rounded-full bg-surface px-3 py-1 text-sm font-medium"
    >
      {STATUS_LABEL[status]}
      {speakingLabel}
    </span>
  );
}

function Transcript({ lines }: { readonly lines: readonly TranscriptLine[] }): React.JSX.Element {
  function renderLine(line: TranscriptLine, index: number): React.JSX.Element {
    const isAgent = line.role === 'assistant';
    return (
      <li key={index} className={isAgent ? 'text-ink' : 'text-brand-strong'}>
        <span className="font-semibold">{isAgent ? 'Asha' : 'You'}:</span> {line.text}
      </li>
    );
  }
  return (
    <section className="min-h-48 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">Live transcript</h2>
      {lines.length === 0 ? (
        <p className="text-ink-muted">The conversation will appear here.</p>
      ) : (
        <ol className="flex flex-col gap-2">{lines.map(renderLine)}</ol>
      )}
    </section>
  );
}
