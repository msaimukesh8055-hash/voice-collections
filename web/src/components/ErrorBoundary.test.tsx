// web/src/components/ErrorBoundary.test.tsx
import { render, screen } from '@testing-library/react';
import { ERROR_BOUNDARY_MESSAGE, ErrorBoundary } from './ErrorBoundary.tsx';

function Broken(): React.JSX.Element {
  throw new Error('secret internals: token abc');
}

function silenceReactErrorLog(): () => void {
  const spy = vi.spyOn(console, 'error').mockImplementation(function ignore() {});
  return function restore() {
    spy.mockRestore();
  };
}

describe('ErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>Call page</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Call page')).toBeInTheDocument();
  });

  it('shows a friendly message, never the error text, when a child crashes', () => {
    const restore = silenceReactErrorLog();
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Broken />
      </ErrorBoundary>,
    );
    restore();
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_BOUNDARY_MESSAGE);
    expect(document.body.textContent).not.toMatch(/secret internals/);
    expect(onError).toHaveBeenCalledOnce();
  });
});
