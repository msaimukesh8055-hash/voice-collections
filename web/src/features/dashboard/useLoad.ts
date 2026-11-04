// web/src/features/dashboard/useLoad.ts
// Loads one dashboard reply and tracks its state, so every page shows the same loading, error
// and "open the link from WhatsApp" states.
import { useEffect, useState } from 'react';
import { NeedsLinkError } from '../../lib/dashboardApi.ts';

export type Loaded<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'needsLink' }
  | { readonly kind: 'failed'; readonly message: string };

const LOAD_ERROR = 'Could not load this page. Refresh to try again.';

export function stateOfError<T>(error: unknown): Loaded<T> {
  if (error instanceof NeedsLinkError) return { kind: 'needsLink' };
  return { kind: 'failed', message: error instanceof Error ? error.message : LOAD_ERROR };
}

/** Runs `load` once per `key` change; a reply for an older key is ignored, and a key with no
 * reply yet reads as "loading". */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [result, setResult] = useState<{ key: string; state: Loaded<T> } | null>(null);
  useEffect(
    function loadData() {
      let active = true;
      load().then(
        function applyData(data) {
          if (active) setResult({ key, state: { kind: 'ready', data } });
        },
        function applyError(error: unknown) {
          if (active) setResult({ key, state: stateOfError<T>(error) });
        },
      );
      return function cancel() {
        active = false;
      };
    },
    // `load` is a new function each render; `key` says when the data really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return result !== null && result.key === key ? result.state : { kind: 'loading' };
}
