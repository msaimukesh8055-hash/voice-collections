// web/src/features/munshi/MunshiPage.tsx
// /munshi — the owner's call line (M8 A7, ADR-0018). Opened from the one-time "📞 Call Munshi"
// link on WhatsApp (#t=<token>). Start call talks to Munshi, who answers from the book; a
// countdown shows the 8 minutes, with "1 minute left" from 7:00. Same beige / brown / gold theme
// and call screen as the phone (M7 B2): a dialling screen while Sarvam connects, then Munshi's
// drawn face on the left and the owner's on the right.
import { useEffect, useState } from 'react';
import type { AppApi } from '../../lib/appApi.ts';
import { MIC_ERROR, type VoiceClient } from '../../lib/sarvamClient.ts';
import { Avatar } from '../phone/Avatar.tsx';
import { formatDuration } from '../phone/CallTimer.tsx';
import { CallVisual } from '../phone/CallVisual.tsx';
import { DiallingScreen } from '../phone/DiallingScreen.tsx';
import { LiveTranscript } from '../phone/LiveTranscript.tsx';
import {
  IN_APP_HINT,
  isInAppBrowser,
  isLastMinute,
  LAST_MINUTE,
  MUNSHI,
  secondsLeft,
  YOU,
} from './munshiState.ts';
import { type MunshiCall, useMunshiCall } from './useMunshiCall.ts';

interface MunshiPageProps {
  readonly api: AppApi;
  readonly voice: VoiceClient;
  /** The signed link token from the address (#t=…), or null when missing or malformed. */
  readonly token: string | null;
  readonly userAgent: string;
}

const BUTTON =
  'h-12 w-full rounded-full font-semibold text-on-brand focus-visible:outline-2 focus-visible:outline-offset-2';
const BRAND_BUTTON = `${BUTTON} bg-brand hover:bg-brand-strong focus-visible:outline-brand`;
/** Munshi is a man; the person on this page is the owner, Srinivas (Saim's Decision 1). */
const MUNSHI_GENDER = 'male';
const OWNER_GENDER = 'male';

function Message({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p role="status" className="rounded-xl bg-surface p-4 ring-1 ring-border">
        {text}
      </p>
    </div>
  );
}

function ReadyScreen({
  onStart,
  inAppBrowser,
}: {
  readonly onStart: () => void;
  readonly inAppBrowser: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Avatar name={MUNSHI} gender={MUNSHI_GENDER} role="agent" size="lg" />
      <h2 className="text-xl font-semibold">Talk to Munshi</h2>
      <p className="text-sm text-ink-muted">
        Ask about your book: who owes what, who is overdue, what Asha heard. Up to 8 minutes.
      </p>
      {inAppBrowser ? (
        <p
          role="note"
          className="rounded-lg bg-surface px-3 py-2 text-sm text-warning ring-1 ring-border"
        >
          {IN_APP_HINT}
        </p>
      ) : null}
      <button type="button" onClick={onStart} className={BRAND_BUTTON}>
        Start call
      </button>
    </div>
  );
}

function Countdown({ startedAt }: { readonly startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(startedAt);

  useEffect(function tickEverySecond() {
    const timer = setInterval(function tick() {
      setNow(Date.now());
    }, 1000);
    return function stopTicking() {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col items-end gap-1">
      <span aria-label="Time left" className="tabular-nums text-sm text-ink-muted">
        {formatDuration(secondsLeft(startedAt, now))}
      </span>
      {isLastMinute(startedAt, now) ? (
        <span role="alert" className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-warning">
          {LAST_MINUTE}
        </span>
      ) : null}
    </div>
  );
}

function InCallScreen({ call }: { readonly call: MunshiCall }): React.JSX.Element | null {
  const { view, hangUp } = call;
  const { screen } = view;
  if (screen.phase !== 'live') return null;

  function handleHangUp(): void {
    void hangUp();
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{MUNSHI}</h2>
        <Countdown startedAt={screen.startedAt} />
      </header>
      <CallVisual
        speaker={view.speaker}
        connecting={false}
        shopkeeperName={YOU}
        agentName={MUNSHI}
        agentGender={MUNSHI_GENDER}
        personGender={OWNER_GENDER}
      />
      <LiveTranscript
        lines={view.transcript}
        shopkeeperName={YOU}
        agentName={MUNSHI}
        speaker={view.speaker}
      />
      <button
        type="button"
        onClick={handleHangUp}
        className={`${BUTTON} bg-danger hover:bg-danger-strong focus-visible:outline-danger`}
      >
        End call
      </button>
    </div>
  );
}

function EndedScreen({ call }: { readonly call: MunshiCall }): React.JSX.Element | null {
  const { screen, transcript } = call.view;
  if (screen.phase !== 'ended') return null;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="text-center">
        <h2 className="text-lg font-semibold">Call ended</h2>
        <p className="text-sm text-ink-muted">
          {MUNSHI} · {formatDuration(screen.seconds)}
        </p>
        {screen.note ? (
          <p role="status" className="mt-1 text-sm text-warning">
            {screen.note}
          </p>
        ) : null}
      </header>
      <LiveTranscript lines={transcript} shopkeeperName={YOU} agentName={MUNSHI} />
      <p className="text-center text-sm text-ink-muted">
        For another call, tap &quot;📞 Call Munshi&quot; on WhatsApp.
      </p>
    </div>
  );
}

function ErrorScreen({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p role="alert" className="rounded-xl bg-surface p-4 text-danger ring-1 ring-border">
        {message}
      </p>
      {message === MIC_ERROR ? <p className="text-sm text-ink-muted">{IN_APP_HINT}</p> : null}
    </div>
  );
}

function MunshiScreenView({
  call,
  inAppBrowser,
}: {
  readonly call: MunshiCall;
  readonly inAppBrowser: boolean;
}): React.JSX.Element | null {
  const { screen } = call.view;

  function handleStart(): void {
    void call.start();
  }

  switch (screen.phase) {
    case 'checking':
      return <Message text="Checking your link…" />;
    case 'ready':
      return <ReadyScreen onStart={handleStart} inAppBrowser={inAppBrowser} />;
    case 'connecting':
      return (
        <DiallingScreen
          agentName={MUNSHI}
          agentGender={MUNSHI_GENDER}
          label={`Calling ${MUNSHI}`}
        />
      );
    case 'live':
      return <InCallScreen call={call} />;
    case 'ended':
      return <EndedScreen call={call} />;
    case 'used':
      return <Message text={screen.message} />;
    case 'error':
      return <ErrorScreen message={screen.message} />;
  }
}

export function MunshiPage({ api, voice, token, userAgent }: MunshiPageProps): React.JSX.Element {
  const call = useMunshiCall(api, voice, token);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex min-h-[640px] w-full max-w-sm flex-col rounded-[2.5rem] bg-surface/95 p-6 shadow-xl ring-1 ring-border">
        <h1 className="mb-4 border-b border-gold pb-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Munshi · Easy Recovery AI demo
        </h1>
        <MunshiScreenView call={call} inAppBrowser={isInAppBrowser(userAgent)} />
      </div>
    </main>
  );
}
