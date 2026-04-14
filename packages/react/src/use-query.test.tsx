import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HttpError } from '@parcely/core';
import { ParcelyProvider } from './context.js';
import { useQuery } from './use-query.js';
import { clearInflight } from './dedup.js';
import { mockClient, makeResponse, deferred } from './test-utils.js';

function wrapper(client: ReturnType<typeof mockClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ParcelyProvider client={client}>{children}</ParcelyProvider>;
  };
}

describe('useQuery', () => {
  beforeEach(() => {
    clearInflight();
  });

  it('happy path: data returned, isSuccess true, isLoading false', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(
      makeResponse({ name: 'Mickey' }),
    );

    const { result } = renderHook(() => useQuery('/users/me'), {
      wrapper: wrapper(client),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ name: 'Mickey' });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('error state: HttpError on error, isError true', async () => {
    const client = mockClient();
    const httpError = new HttpError('Not Found', {
      code: 'ERR_HTTP_STATUS',
      status: 404,
      config: { url: '/users/me' },
    });
    vi.mocked(client.get).mockRejectedValueOnce(httpError);

    const { result } = renderHook(() => useQuery('/users/me'), {
      wrapper: wrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(httpError);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('refetch forces fresh request (bypasses dedup)', async () => {
    const client = mockClient();
    vi.mocked(client.get)
      .mockResolvedValueOnce(makeResponse('first'))
      .mockResolvedValueOnce(makeResponse('second'));

    const { result } = renderHook(() => useQuery('/users'), {
      wrapper: wrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe('first');

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data).toBe('second');
    });

    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('abort on unmount: controller.abort() called', async () => {
    const client = mockClient();
    const { promise, resolve } = deferred<ReturnType<typeof makeResponse>>();
    vi.mocked(client.get).mockReturnValueOnce(promise);

    const { unmount } = renderHook(() => useQuery('/users'), {
      wrapper: wrapper(client),
    });

    // Unmount before settling
    unmount();

    // The get call should have received a signal
    const callArgs = vi.mocked(client.get).mock.calls[0];
    expect(callArgs).toBeDefined();
    const config = callArgs![1] as { signal?: AbortSignal };
    expect(config.signal).toBeDefined();
    expect(config.signal!.aborted).toBe(true);

    // Resolve to prevent unhandled rejection
    resolve(makeResponse('ok'));
  });

  it('dedup: two concurrent hooks with same URL share one client.get call', async () => {
    const client = mockClient();
    const { promise, resolve } = deferred<ReturnType<typeof makeResponse>>();
    vi.mocked(client.get).mockReturnValue(promise);

    const w = wrapper(client);
    renderHook(() => useQuery('/users'), { wrapper: w });
    renderHook(() => useQuery('/users'), { wrapper: w });

    // Only one call to client.get
    expect(client.get).toHaveBeenCalledTimes(1);

    resolve(makeResponse('shared'));
  });

  it('validate narrows data (runtime check)', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(makeResponse({ id: 1 }));

    const validator = (input: unknown) => input as { id: number };
    const { result } = renderHook(
      () => useQuery('/users/1', { validate: validator }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ id: 1 });
  });

  it('client-from-options overrides provider', async () => {
    const providerClient = mockClient();
    const optionsClient = mockClient();
    vi.mocked(optionsClient.get).mockResolvedValueOnce(makeResponse('from-options'));

    const { result } = renderHook(
      () => useQuery('/users', { client: optionsClient }),
      { wrapper: wrapper(providerClient) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(optionsClient.get).toHaveBeenCalledTimes(1);
    expect(providerClient.get).not.toHaveBeenCalled();
  });

  it('enabled: false skips fetch', async () => {
    const client = mockClient();

    const { result } = renderHook(
      () => useQuery('/users', { enabled: false }),
      { wrapper: wrapper(client) },
    );

    // Should not be loading, no fetch
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(client.get).not.toHaveBeenCalled();
  });
});
