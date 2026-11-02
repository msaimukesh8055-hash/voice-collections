// web/src/features/voice-spike/VoiceSpikePage.tsx
// Test call page (M1 spike, M2 platform test): pick a fake borrower, authorise the call on our
// server (pre-call compliance check), then talk to Asha in that borrower's language.
// Replaced by the full call simulator in M5.
import { useEffect, useState, type ChangeEvent } from 'react';
import { collectionsAgent } from '@voice-agents/collections/assistant.config.ts';
import { buildCallOverrides } from '@voice-agents/vapi-payload.ts';
import type { AuthoriseResult, CallsApi, CustomerOption } from '../../lib/callsApi.ts';
import type { CallStatus, TranscriptLine, VoiceClient } from '../../lib/vapiClient.ts';

const STATUS_LABEL: Readonly<Record<CallStatus, string>> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  live: 'Live',
  ended: 'Call ended',
  error: 'Error',
};

const MIC_ERROR = 'Could not start the call. Allow microphone access and retry.';
const SERVER_ERROR = 'Could not reach the server. Check your connection and retry.';
const LOAD_ERROR = 'Could not reach the server to load customers. Refresh the page to retry.';

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

interface PageProps {
  readonly client: VoiceClient;
  readonly api: CallsApi;
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

function useCustomers(api: CallsApi): {
  readonly customers: readonly CustomerOption[];
  readonly loadError: string | null;
} {
  const [customers, setCustomers] = useState<readonly CustomerOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(
    function loadCustomers() {
      let active = true;
      api.listCustomers().then(
        function applyCustomers(list) {
          if (active) setCustomers(list);
        },
        function applyLoadError() {
          if (active) setLoadError(LOAD_ERROR);
        },
      );
      return function cancel() {
        active = false;
      };
    },
    [api],
  );

  return { customers, loadError };
}

function toServerError(): AuthoriseResult {
  return { ok: false, message: SERVER_ERROR };
}

interface StartRequest {
  readonly api: CallsApi;
  readonly client: VoiceClient;
  readonly customerId: string;
}

/** Authorises on our server first; returns the block reason, or null once the call starts. */
async function authoriseAndStart({
  api,
  client,
  customerId,
}: StartRequest): Promise<string | null> {
  const authorised = await api.authoriseCall(customerId).catch(toServerError);
  if (!authorised.ok) return authorised.message;
  const details = authorised.call;
  await client.start(buildCallOverrides(collectionsAgent, details.language, details));
  return null;
}

function PageHeader(): React.JSX.Element {
  return (
    <header>
      <p className="text-sm font-medium uppercase tracking-wide text-brand">M2 · Platform test</p>
      <h1 className="text-3xl font-semibold">Test call — Suvidha Finance collections</h1>
    </header>
  );
}

export function VoiceSpikePage({ client, api }: PageProps): React.JSX.Element {
  const { customers, loadError } = useCustomers(api);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const call = useVoiceCall(client);
  const inCall = call.status === 'connecting' || call.status === 'live';
  const customerId = chosenId ?? customers[0]?.id ?? null;
  const errorMessage = call.error ?? loadError;

  function handleCustomerChange(event: ChangeEvent<HTMLSelectElement>): void {
    setChosenId(event.target.value);
  }

  async function handleStart(): Promise<void> {
    if (customerId === null) return;
    call.setState({ ...INITIAL_STATE, status: 'connecting' });
    try {
      const blocked = await authoriseAndStart({ api, client, customerId });
      if (blocked !== null) call.setState({ status: 'idle', error: `Call blocked: ${blocked}` });
    } catch {
      call.setState({ status: 'error', error: MIC_ERROR });
    }
  }

  async function handleStop(): Promise<void> {
    await client.stop();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <PageHeader />
      <CustomerPicker
        customers={customers}
        selectedId={customerId}
        disabled={inCall}
        onChange={handleCustomerChange}
      />
      <CallControls
        inCall={inCall}
        canStart={customerId !== null}
        onStart={handleStart}
        onStop={handleStop}
      >
        <StatusBadge status={call.status} agentSpeaking={call.agentSpeaking} />
      </CallControls>
      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      <Transcript lines={call.transcript} />
    </main>
  );
}

interface CallControlsProps {
  readonly inCall: boolean;
  readonly canStart: boolean;
  readonly onStart: () => Promise<void>;
  readonly onStop: () => Promise<void>;
  readonly children: React.ReactNode;
}

function CallControls({
  inCall,
  canStart,
  onStart,
  onStop,
  children,
}: CallControlsProps): React.JSX.Element {
  return (
    <section className="flex items-center gap-3">
      <button
        type="button"
        onClick={onStart}
        disabled={inCall || !canStart}
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

interface CustomerPickerProps {
  readonly customers: readonly CustomerOption[];
  readonly selectedId: string | null;
  readonly disabled: boolean;
  readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

/** The call language follows the borrower's preferred language. */
function CustomerPicker({
  customers,
  selectedId,
  disabled,
  onChange,
}: CustomerPickerProps): React.JSX.Element {
  function renderOption(customer: CustomerOption): React.JSX.Element {
    const language = collectionsAgent.variants[customer.language].label;
    return (
      <option key={customer.id} value={customer.id}>
        {customer.fullName} — {language} · {customer.city}
      </option>
    );
  }
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-ink-muted">
      Customer
      <select
        value={selectedId ?? ''}
        disabled={disabled || customers.length === 0}
        onChange={onChange}
        className="rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-ink"
      >
        {customers.map(renderOption)}
      </select>
    </label>
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
