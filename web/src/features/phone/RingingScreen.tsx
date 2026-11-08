// web/src/features/phone/RingingScreen.tsx
// An incoming call, like a real phone: who is calling, who you answer as (any shopkeeper can be
// called live, Live remind pre-M6), Accept and Decline.
interface RingingScreenProps {
  readonly callerName: string;
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

export function RingingScreen({
  callerName,
  shopkeeperName,
  shopName,
  onAccept,
  onDecline,
}: RingingScreenProps): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-8 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">Incoming call</p>
        <div className="flex h-24 w-24 animate-ring items-center justify-center rounded-full bg-brand text-4xl font-semibold text-on-brand shadow-lg ring-2 ring-gold ring-offset-2 ring-offset-surface">
          {callerName.charAt(0)}
        </div>
        <h2 className="text-2xl font-semibold">{callerName}</h2>
        <p className="text-sm text-ink-muted">Ringing…</p>
        <p className="rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-border">
          Answer as <span className="font-semibold">{shopkeeperName}</span> · {shopName}
        </p>
      </div>
      <div className="flex w-full justify-around">
        <button
          type="button"
          onClick={onDecline}
          className="h-14 w-32 rounded-full bg-danger font-semibold text-on-brand hover:bg-danger-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="h-14 w-32 rounded-full bg-success font-semibold text-on-brand hover:bg-success-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
