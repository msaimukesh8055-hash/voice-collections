// web/src/features/phone/PhonePage.tsx
// /phone — the shopkeeper's phone (SPEC §7.1). Open it in a second window, press "Ring" on the
// home page, and it rings like a real phone; Accept starts the Sarvam call with Asha.
import type { AppApi } from '../../lib/appApi.ts';
import type { VoiceClient } from '../../lib/sarvamClient.ts';
import { CallTimer, formatDuration } from './CallTimer.tsx';
import { CallVisual } from './CallVisual.tsx';
import { LiveTranscript } from './LiveTranscript.tsx';
import { type PhoneView, YOU } from './phoneState.ts';
import { RingingScreen } from './RingingScreen.tsx';
import { type PhoneCall, usePhoneCall } from './usePhoneCall.ts';

interface PhonePageProps {
  readonly api: AppApi;
  readonly voice: VoiceClient;
}

const BUTTON =
  'h-12 w-full rounded-full font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2';

function WaitingScreen({ notice }: { readonly notice: string | null }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div aria-hidden="true" className="h-16 w-16 rounded-full bg-brand-soft" />
      <h2 className="text-xl font-semibold">Waiting for a call…</h2>
      <p className="text-sm text-ink-muted">
        Keep this window open. It rings when a call comes in.
      </p>
      {notice ? (
        <p role="status" className="rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-border">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function InCallScreen({ call }: { readonly call: PhoneCall }): React.JSX.Element {
  const { view, hangUp } = call;
  const { screen } = view;
  const live = screen.phase === 'live';

  function handleHangUp(): void {
    void hangUp();
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{'call' in screen ? screen.call.callerName : ''}</h2>
        {live ? <CallTimer startedAt={screen.startedAt} /> : null}
      </header>
      <CallVisual
        speaker={view.speaker}
        connecting={!live}
        shopkeeperName={live ? screen.shopkeeperName : YOU}
      />
      <LiveTranscript lines={view.transcript} shopkeeperName={live ? screen.shopkeeperName : YOU} />
      <button
        type="button"
        onClick={handleHangUp}
        disabled={!live}
        className={`${BUTTON} bg-danger hover:bg-danger-strong focus-visible:outline-danger disabled:opacity-50`}
      >
        End call
      </button>
    </div>
  );
}

function EndedScreen({
  view,
  onDone,
}: {
  readonly view: PhoneView;
  readonly onDone: () => void;
}): React.JSX.Element | null {
  const { screen } = view;
  if (screen.phase !== 'ended') return null;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="text-center">
        <h2 className="text-lg font-semibold">Call ended</h2>
        <p className="text-sm text-ink-muted">
          {screen.call.callerName} · {formatDuration(screen.seconds)}
        </p>
        {screen.note ? (
          <p role="status" className="mt-1 text-sm text-warning">
            {screen.note}
          </p>
        ) : null}
      </header>
      <LiveTranscript lines={view.transcript} shopkeeperName={screen.shopkeeperName} />
      <button
        type="button"
        onClick={onDone}
        className={`${BUTTON} bg-brand hover:bg-brand-strong focus-visible:outline-brand`}
      >
        Done
      </button>
    </div>
  );
}

function ErrorScreen({
  message,
  onBack,
}: {
  readonly message: string;
  readonly onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p role="alert" className="rounded-xl bg-surface p-4 text-danger ring-1 ring-border">
        {message}
      </p>
      <button
        type="button"
        onClick={onBack}
        className={`${BUTTON} bg-brand hover:bg-brand-strong focus-visible:outline-brand`}
      >
        Back
      </button>
    </div>
  );
}

function PhoneScreen({ call }: { readonly call: PhoneCall }): React.JSX.Element | null {
  const { view, accept, decline, reset } = call;
  const { screen } = view;

  function handleAccept(): void {
    void accept();
  }

  function handleDecline(): void {
    void decline();
  }

  switch (screen.phase) {
    case 'waiting':
      return <WaitingScreen notice={screen.notice} />;
    case 'ringing':
      return (
        <RingingScreen
          callerName={screen.call.callerName}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      );
    case 'connecting':
    case 'live':
      return <InCallScreen call={call} />;
    case 'ended':
      return <EndedScreen view={view} onDone={reset} />;
    case 'error':
      return <ErrorScreen message={screen.message} onBack={reset} />;
  }
}

export function PhonePage({ api, voice }: PhonePageProps): React.JSX.Element {
  const call = usePhoneCall(api, voice);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex min-h-[640px] w-full max-w-sm flex-col rounded-[2.5rem] bg-surface p-6 shadow-xl ring-1 ring-border">
        <h1 className="mb-4 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Shopkeeper&apos;s phone · Easy Recovery AI demo
        </h1>
        <PhoneScreen call={call} />
      </div>
    </main>
  );
}
