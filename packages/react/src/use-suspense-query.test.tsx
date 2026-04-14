import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Suspense, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { HttpError } from '@parcely/core';
import { ParcelyProvider } from './context.js';
import { useSuspenseQuery, clearSuspenseCache } from './use-suspense-query.js';
import { clearInflight } from './dedup.js';
import { mockClient, makeResponse, deferred } from './test-utils.js';

// ---- ErrorBoundary helper ------------------------------------------------

interface ErrorBoundaryProps {
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // intentionally empty
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

// ---- Test component -------------------------------------------------------

function TestComponent({
  url,
  client: explicitClient,
}: {
  url: string;
  client?: ReturnType<typeof mockClient>;
}) {
  const { data } = useSuspenseQuery(url, {
    client: explicitClient,
  });
  return <div data-testid="data">{JSON.stringify(data)}</div>;
}

describe('useSuspenseQuery', () => {
  beforeEach(() => {
    clearInflight();
    clearSuspenseCache();
  });

  afterEach(() => {
    cleanup();
  });

  it('throws promise during loading — Suspense fallback renders', async () => {
    const client = mockClient();
    const { promise, resolve } = deferred<ReturnType<typeof makeResponse>>();
    vi.mocked(client.get).mockReturnValueOnce(promise);

    render(
      <ParcelyProvider client={client}>
        <Suspense fallback={<div data-testid="fallback">Loading...</div>}>
          <TestComponent url="/users" />
        </Suspense>
      </ParcelyProvider>,
    );

    // Fallback should be visible
    expect(screen.getByTestId('fallback')).toBeDefined();

    // Resolve the promise
    resolve(makeResponse({ name: 'Mickey' }));

    // Data should render
    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeDefined();
    });

    expect(screen.getByTestId('data').textContent).toBe(
      JSON.stringify({ name: 'Mickey' }),
    );
  });

  it('resolves on success — data is non-null, content renders', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(makeResponse({ id: 42 }));

    render(
      <ParcelyProvider client={client}>
        <Suspense fallback={<div>Loading...</div>}>
          <TestComponent url="/items/42" />
        </Suspense>
      </ParcelyProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeDefined();
    });

    expect(screen.getByTestId('data').textContent).toBe(
      JSON.stringify({ id: 42 }),
    );
  });

  it('throws HttpError on error — ErrorBoundary renders error UI', async () => {
    const client = mockClient();
    const httpError = new HttpError('Server Error', {
      code: 'ERR_HTTP_STATUS',
      status: 500,
      config: { url: '/fail' },
    });
    vi.mocked(client.get).mockRejectedValueOnce(httpError);

    // Suppress React's console.error for expected error boundary trigger
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ParcelyProvider client={client}>
        <ErrorBoundary
          fallback={(error) => (
            <div data-testid="error">{error.message}</div>
          )}
        >
          <Suspense fallback={<div>Loading...</div>}>
            <TestComponent url="/fail" />
          </Suspense>
        </ErrorBoundary>
      </ParcelyProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });

    expect(screen.getByTestId('error').textContent).toBe('Server Error');

    spy.mockRestore();
  });
});
