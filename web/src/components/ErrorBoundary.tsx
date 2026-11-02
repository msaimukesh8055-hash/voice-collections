// web/src/components/ErrorBoundary.tsx
// Catches render errors so a bug shows a friendly card instead of a blank page mid-call
// (coding-standards › React rules; CP1 M4). No stack trace or error text is shown.
// React only offers error boundaries as class components.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Called with the error for logging or tests; the screen never shows it. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export const ERROR_BOUNDARY_MESSAGE = 'Something went wrong on this page. Refresh to try again.';

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-xl p-6">
        <div role="alert" className="rounded-xl border border-border bg-surface p-5 text-ink">
          {ERROR_BOUNDARY_MESSAGE}
        </div>
      </main>
    );
  }
}
