// web/src/features/demo/DemoControls.tsx
// "Ring" button for the demo (M3 Decision 8): queues a live call to the demo shopkeeper through
// the same queueCall path WhatsApp's Remind button will use in M4. The call rings on /phone,
// opened in a second window.
import { useEffect, useState } from 'react';
import type { AppApi, DemoInfo } from '../../lib/appApi.ts';

interface DemoControlsProps {
  readonly api: AppApi;
}

type RingState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

const LOAD_ERROR = 'Could not load the demo settings. Refresh the page to try again.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : LOAD_ERROR;
}

function useDemoInfo(api: AppApi): {
  readonly demo: DemoInfo | null;
  readonly error: string | null;
} {
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    function loadDemo() {
      let active = true;
      api.getDemo().then(
        function applyDemo(info) {
          if (active) setDemo(info);
        },
        function applyError() {
          if (active) setError(LOAD_ERROR);
        },
      );
      return function cancel() {
        active = false;
      };
    },
    [api],
  );

  return { demo, error };
}

function ShopkeeperLine({ demo }: { readonly demo: DemoInfo }): React.JSX.Element {
  const live = demo.liveShopkeeper;
  if (!live)
    return <p className="text-sm text-ink-muted">No live shopkeeper is set for the demo.</p>;
  return (
    <p className="text-sm">
      Live shopkeeper: <span className="font-semibold">{live.name}</span> · {live.shopName}
    </p>
  );
}

function PhoneHint(): React.JSX.Element {
  return (
    <p className="mt-2 text-sm text-ink-muted">
      Open the{' '}
      <a
        href="/phone"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-brand underline"
      >
        phone page
      </a>{' '}
      in a second window, then ring.
    </p>
  );
}

function RingMessage({ ring }: { readonly ring: RingState }): React.JSX.Element | null {
  if (ring.kind === 'done') {
    return (
      <p role="status" className="mt-3 text-sm text-success">
        {ring.message}
      </p>
    );
  }
  if (ring.kind === 'failed') {
    return (
      <p role="alert" className="mt-3 text-sm text-danger">
        {ring.message}
      </p>
    );
  }
  return null;
}

export function DemoControls({ api }: DemoControlsProps): React.JSX.Element {
  const { demo, error } = useDemoInfo(api);
  const [ring, setRing] = useState<RingState>({ kind: 'idle' });
  const name = demo?.liveShopkeeper?.name ?? null;

  async function handleRing(): Promise<void> {
    setRing({ kind: 'busy' });
    try {
      const result = await api.ring();
      const message = result.alreadyQueued
        ? `${name ?? 'The shopkeeper'} is already being rung.`
        : `Ringing ${name ?? 'the shopkeeper'}. Answer on the phone page.`;
      setRing({ kind: 'done', message });
    } catch (ringError) {
      setRing({ kind: 'failed', message: messageOf(ringError) });
    }
  }

  function handleRingClick(): void {
    void handleRing();
  }

  return (
    <section
      aria-labelledby="demo-heading"
      className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border"
    >
      <h2 id="demo-heading" className="text-lg font-semibold">
        Demo call
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {demo ? <ShopkeeperLine demo={demo} /> : null}
      <PhoneHint />
      <button
        type="button"
        onClick={handleRingClick}
        disabled={!name || ring.kind === 'busy'}
        className="mt-4 h-11 rounded-full bg-brand px-6 font-semibold text-white hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
      >
        {ring.kind === 'busy' ? 'Ringing…' : `Ring ${name ?? ''}`.trim()}
      </button>
      <RingMessage ring={ring} />
    </section>
  );
}
