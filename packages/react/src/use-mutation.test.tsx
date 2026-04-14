import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HttpError } from '@parcely/core';
import { ParcelyProvider } from './context.js';
import { useMutation } from './use-mutation.js';
import { mockClient, makeResponse, deferred } from './test-utils.js';

function wrapper(client: ReturnType<typeof mockClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ParcelyProvider client={client}>{children}</ParcelyProvider>;
  };
}

describe('useMutation', () => {
  it('mutate fires request, isPending true during flight, false after', async () => {
    const client = mockClient();
    const { promise, resolve } = deferred<ReturnType<typeof makeResponse>>();
    vi.mocked(client.request).mockReturnValueOnce(promise);

    const { result } = renderHook(
      () => useMutation('POST', '/users'),
      { wrapper: wrapper(client) },
    );

    expect(result.current.isPending).toBe(false);

    act(() => {
      result.current.mutate({ name: 'Mickey' });
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolve(makeResponse({ id: 1 }));
      // Wait for state updates
      await promise;
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual({ id: 1 });
  });

  it('error state: error set on rejection', async () => {
    const client = mockClient();
    const httpError = new HttpError('Bad Request', {
      code: 'ERR_HTTP_STATUS',
      status: 400,
      config: { method: 'POST', url: '/users' },
    });
    vi.mocked(client.request).mockRejectedValueOnce(httpError);

    const { result } = renderHook(
      () => useMutation('POST', '/users'),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.mutate({ name: '' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(httpError);
    expect(result.current.isPending).toBe(false);
  });

  it('mutateAsync returns the promise (can be awaited)', async () => {
    const client = mockClient();
    const response = makeResponse({ id: 2 });
    vi.mocked(client.request).mockResolvedValueOnce(response);

    const { result } = renderHook(
      () => useMutation('POST', '/users'),
      { wrapper: wrapper(client) },
    );

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.mutateAsync({ name: 'Test' });
    });

    expect(resolved).toBe(response);
    expect(result.current.isSuccess).toBe(true);
  });

  it('reset clears state to idle', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockResolvedValueOnce(makeResponse('ok'));

    const { result } = renderHook(
      () => useMutation('POST', '/users'),
      { wrapper: wrapper(client) },
    );

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(result.current.isSuccess).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('does NOT abort on unmount — client.request is NOT aborted', async () => {
    const client = mockClient();
    const { promise, resolve } = deferred<ReturnType<typeof makeResponse>>();
    vi.mocked(client.request).mockReturnValueOnce(promise);

    const { result, unmount } = renderHook(
      () => useMutation('POST', '/users'),
      { wrapper: wrapper(client) },
    );

    act(() => {
      result.current.mutate({ name: 'Mickey' });
    });

    // Unmount while request is in flight
    unmount();

    // The request call should NOT have been passed a signal / the signal
    // should NOT be aborted — useMutation does not abort on unmount
    const callArgs = vi.mocked(client.request).mock.calls[0]!;
    const config = callArgs[0] as { signal?: AbortSignal };
    // No signal should be present on mutation requests
    expect(config.signal).toBeUndefined();

    // Resolve to prevent unhandled rejection
    resolve(makeResponse('ok'));
  });
});
