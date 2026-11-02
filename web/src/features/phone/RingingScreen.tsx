// web/src/features/phone/RingingScreen.tsx
// An incoming call, like a real phone: who is calling, Accept and Decline.
interface RingingScreenProps {
  readonly callerName: string;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

export function RingingScreen({
  callerName,
  onAccept,
  onDecline,
}: RingingScreenProps): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-8 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">Incoming call</p>
        <div className="flex h-24 w-24 animate-ring items-center justify-center rounded-full bg-brand text-4xl font-semibold text-white shadow-lg">
          {callerName.charAt(0)}
        </div>
        <h2 className="text-2xl font-semibold">{callerName}</h2>
        <p className="text-sm text-ink-muted">Ringing…</p>
      </div>
      <div className="flex w-full justify-around">
        <button
          type="button"
          onClick={onDecline}
          className="h-14 w-32 rounded-full bg-danger font-semibold text-white hover:bg-danger-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="h-14 w-32 rounded-full bg-success font-semibold text-white hover:bg-success-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
