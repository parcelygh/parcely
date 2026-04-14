import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRetry } from './index.js';
import { createAuthToken } from '@parcely/auth-token';
import type {
  Client,
  RequestConfig,
  HttpResponse,
  InterceptorHandler,
} from '@parcely/core';

// ---------------------------------------------------------------------------
// Mock Client factory (same pattern as auth-token)
// ---------------------------------------------------------------------------

interface MockInterceptorManager<T> {
  use(handler: InterceptorHandler<T>): number;
  use(
    onFulfilled?: (value: T) => T | Promise<T>,
    onRejected?: (err: unknown) => unknown,
  ): number;
  eject(id: number): void;
  _handlers: InterceptorHandler<T>[];
}

function createMockInterceptorManager<T>(): MockInterceptorManager<T> {
  const handlers: InterceptorHandler<T>[] = [];
  let nextId = 0;

  return {
    use(
      handlerOrFulfilled?:
        | InterceptorHandler<T>
        | ((value: T) => T | Promise<T>),
      onRejected?: (err: unknown) => unknown,
    ): number {
      const id = nextId++;
      if (
        typeof handlerOrFulfilled === 'object' &&
        handlerOrFulfilled !== null
      ) {
        handlers.push(handlerOrFulfilled);
      } else {
        const handler: InterceptorHandler<T> = {};
        if (handlerOrFulfilled) {
          handler.fulfilled = handlerOrFulfilled;
        }
        if (onRejected) {
          handler.rejected = onRejected;
        }
        handlers.push(handler);
      }
      return id;
    },
    eject(_id: number): void {
      // Not needed for tests
    },
    _handlers: handlers,
  };
}

interface MockClient extends Client {
  interceptors: {
    request: MockInterceptorManager<RequestConfig>;
    response: MockInterceptorManager<HttpResponse<unknown>>;
  };
  _requestImpl: (
    config: RequestConfig,
  ) => Promise<HttpResponse<unknown>>;
}

function createMockClient(
  requestImpl?: (
    config: RequestConfig,
  ) => Promise<HttpResponse<unknown>>,
): MockClient {
  const defaultImpl = (_config: RequestConfig): Promise<HttpResponse<unknown>> =>
    Promise.resolve({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config: _config,
    });

  const client: MockClient = {
    defaults: {},
    interceptors: {
      request: createMockInterceptorManager<RequestConfig>(),
      response: createMockInterceptorManager<HttpResponse<unknown>>(),
    },
    _requestImpl: requestImpl ?? defaultImpl,
    request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
      return client._requestImpl(config) as Promise<HttpResponse<T>>;
    },
    get<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'GET' });
    },
    delete<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'DELETE' });
    },
    head<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'HEAD' });
    },
    options<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'OPTIONS' });
    },
    post<T, B = unknown>(
      url: string,
      body?: B,
      config?: RequestConfig,
    ): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'POST', body });
    },
    put<T, B = unknown>(
      url: string,
      body?: B,
      config?: RequestConfig,
    ): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'PUT', body });
    },
    patch<T, B = unknown>(
      url: string,
      body?: B,
      config?: RequestConfig,
    ): Promise<HttpResponse<T>> {
      return client.request<T>({ ...config, url, method: 'PATCH', body });
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// HttpError-like factory (structural — no runtime import from parcely)
// ---------------------------------------------------------------------------

function createHttpError(opts: {
  code: string;
  status?: number | undefined;
  config?: RequestConfig | undefined;
  message?: string | undefined;
  response?: HttpResponse<unknown> | undefined;
}): Error & {
  code: string;
  status?: number | undefined;
  config?: RequestConfig | undefined;
  response?: HttpResponse<unknown> | undefined;
} {
  const err = new Error(opts.message ?? 'Request failed') as Error & {
    code: string;
    status?: number | undefined;
    config?: RequestConfig | undefined;
    response?: HttpResponse<unknown> | undefined;
  };
  err.code = opts.code;
  if (opts.status !== undefined) {
    err.status = opts.status;
  }
  err.config = opts.config ?? { url: '/test', method: 'GET' };
  if (opts.response !== undefined) {
    err.response = opts.response;
  }
  return err;
}

function makeResponse(
  overrides: Partial<HttpResponse<unknown>> & { headers?: Headers },
): HttpResponse<unknown> {
  return {
    data: {},
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config: { url: '/test' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1
  it('retries GET on 503 and resolves when server eventually returns 200', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 0 });
    retry.install(client);

    let callCount = 0;
    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      callCount++;
      if (callCount < 2) {
        throw createHttpError({
          code: 'ERR_HTTP_STATUS',
          status: 503,
          config,
          response: makeResponse({ status: 503, headers: new Headers() }),
        });
      }
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const firstErr = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 503,
      config: { url: '/api', method: 'GET' },
      response: makeResponse({ status: 503, headers: new Headers() }),
    });

    const resultPromise = rejected(firstErr);
    // Flush all timers to drive the internal retry loop to completion
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
    // 2 calls total: first retry fails (callCount=1), second succeeds (callCount=2)
    expect(client._requestImpl).toHaveBeenCalledTimes(2);
  });

  // 2
  it('exhausts retries when server always 500s — final error propagates with original code', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 2, delay: 0 });
    retry.install(client);

    const serverErr = (config: RequestConfig) =>
      createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 500,
        config,
        response: makeResponse({ status: 500, headers: new Headers() }),
      });

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      throw serverErr(config);
    });

    const rejected = retry.response.rejected!;
    const initialErr = serverErr({ url: '/api', method: 'GET' });

    const p = (rejected(initialErr) as Promise<unknown>).catch((e: unknown) => e);
    // Flush all timers to drive the internal retry loop to completion
    await vi.runAllTimersAsync();

    const thrown = await p;
    const e = thrown as { code: string };
    expect(e.code).toBe('ERR_HTTP_STATUS');
  });

  // 3
  it('does NOT retry POST by default (non-idempotent)', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 0 });
    retry.install(client);

    const requestSpy = vi.fn(client._requestImpl);
    client._requestImpl = requestSpy;

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 503,
      config: { url: '/api', method: 'POST' },
      response: makeResponse({ status: 503, headers: new Headers() }),
    });

    await expect(rejected(err)).rejects.toThrow();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  // 4
  it('DOES retry POST when caller includes it in opts.methods', async () => {
    const client = createMockClient();
    const retry = createRetry({
      count: 1,
      delay: 0,
      methods: ['GET', 'POST'],
    });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 503,
      config: { url: '/api', method: 'POST' },
      response: makeResponse({ status: 503, headers: new Headers() }),
    });

    const resultPromise = rejected(err);
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
    expect(client._requestImpl).toHaveBeenCalledTimes(1);
  });

  // 5
  it('does not retry on ERR_VALIDATION (security category)', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 0 });
    retry.install(client);

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_VALIDATION',
      config: { url: '/api', method: 'GET' },
    });

    await expect(rejected(err)).rejects.toThrow();
  });

  // 6
  it('does not retry on ERR_ABORTED (user-initiated cancel)', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 0 });
    retry.install(client);

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_ABORTED',
      config: { url: '/api', method: 'GET' },
    });

    await expect(rejected(err)).rejects.toThrow();
  });

  // 7
  it('respects Retry-After integer header on 429', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 1 });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const headers429 = new Headers();
    headers429.set('retry-after', '2');

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 429,
      config: { url: '/api', method: 'GET' },
      response: makeResponse({ status: 429, headers: headers429 }),
    });

    const p = rejected(err);

    // Should NOT have retried yet (waiting 2000ms)
    await vi.advanceTimersByTimeAsync(1999);
    expect(client._requestImpl).not.toHaveBeenCalled();

    // Now advance past the 2s mark
    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
  });

  // 8
  it('respects Retry-After HTTP-date header on 503', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 1, maxDelayMs: 120_000 });
    retry.install(client);

    // Set the clock to a known time
    vi.setSystemTime(new Date('2026-10-21T07:27:00.000Z'));

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const headers503 = new Headers();
    headers503.set('retry-after', 'Wed, 21 Oct 2026 07:28:00 GMT');

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 503,
      config: { url: '/api', method: 'GET' },
      response: makeResponse({ status: 503, headers: headers503 }),
    });

    const p = rejected(err);

    // Should wait ~60s
    await vi.advanceTimersByTimeAsync(59_999);
    expect(client._requestImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
  });

  // 9
  it('clamps Retry-After at maxDelayMs so a hostile 99999s header can\'t DoS the client', async () => {
    const client = createMockClient();
    const maxDelayMs = 5000;
    const retry = createRetry({ count: 1, maxDelayMs });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const headersHostile = new Headers();
    headersHostile.set('retry-after', '99999');

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_HTTP_STATUS',
      status: 429,
      config: { url: '/api', method: 'GET' },
      response: makeResponse({ status: 429, headers: headersHostile }),
    });

    const p = rejected(err);

    // Should be clamped to maxDelayMs (5000ms), not 99999 * 1000
    await vi.advanceTimersByTimeAsync(4999);
    expect(client._requestImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
  });

  // 10
  it('user-provided retryOn predicate overrides defaults', async () => {
    const client = createMockClient();
    const retry = createRetry({
      count: 1,
      delay: 0,
      retryOn: (err) => err.code === 'ERR_VALIDATION', // normally not retried
    });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_VALIDATION',
      config: { url: '/api', method: 'GET' },
    });

    const resultPromise = rejected(err);
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
  });

  // 11
  it('user-provided delay function receives (attempt, err) and its return value is used', async () => {
    const client = createMockClient();
    const delayFn = vi.fn((_attempt: number, _err: unknown) => 1234);
    const retry = createRetry({ count: 1, delay: delayFn });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
    });

    const p = rejected(err);

    expect(delayFn).toHaveBeenCalledWith(1, err);

    // Should not fire before 1234ms
    await vi.advanceTimersByTimeAsync(1233);
    expect(client._requestImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
  });

  // 12
  it('onRetry hook fires once per retry with { attempt, error, delayMs }', async () => {
    const client = createMockClient();
    const onRetry = vi.fn();
    const retry = createRetry({ count: 3, delay: 100, onRetry });
    retry.install(client);

    let callNum = 0;
    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      callNum++;
      if (callNum < 3) {
        throw createHttpError({
          code: 'ERR_NETWORK',
          config,
        });
      }
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
    });

    const p = rejected(err);
    // Advance through all three retry sleeps (100ms each)
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await p;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });

    // onRetry should have been called for each retry attempt
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls[0]![0]).toEqual({
      attempt: 1,
      error: err,
      delayMs: 100,
    });
    // Verify the second call gets the error from the first retry
    expect(onRetry.mock.calls[1]![0]!.attempt).toBe(2);
    expect(onRetry.mock.calls[2]![0]!.attempt).toBe(3);
  });

  // 13
  it('onRetry hook throwing aborts the retry loop and rethrows the original error', async () => {
    const client = createMockClient();
    const onRetry = vi.fn(() => {
      throw new Error('cancel');
    });
    const retry = createRetry({ count: 3, delay: 0, onRetry });
    retry.install(client);

    const rejected = retry.response.rejected!;
    const originalErr = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
      message: 'network failure',
    });

    // The onRetry hook throws synchronously before sleep, so the promise
    // should reject with the original error.
    await expect(rejected(originalErr)).rejects.toBe(originalErr);
  });

  // 14
  it('AbortSignal aborted during backoff sleep prevents the retry from firing', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 5000 });
    retry.install(client);

    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const controller = new AbortController();
    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET', signal: controller.signal },
    });

    const p = rejected(err);

    // Abort mid-sleep (after 1s of 5s delay)
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();

    await expect(p).rejects.toThrow();
    // The client should never have been called — abort happened during sleep
    expect(client._requestImpl).not.toHaveBeenCalled();
  });

  // 15
  it('install() wires the response error interceptor and retry requests go through client.request', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 1, delay: 0 });

    retry.install(client);

    // Verify the interceptor was registered
    expect(client.interceptors.response._handlers).toHaveLength(1);
    expect(client.interceptors.response._handlers[0]!.rejected).toBe(
      retry.response.rejected,
    );

    // Prove retry goes through client.request
    const requestSpy = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { retried: true }, config });
    });
    client._requestImpl = requestSpy;

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
    });

    const resultPromise = rejected(err);
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect((result as HttpResponse<unknown>).data).toEqual({ retried: true });
  });

  // 16
  it('when install() was not called, retry falls back to rethrowing (no clientRef)', async () => {
    const retry = createRetry({ count: 3, delay: 0 });
    // Deliberately NOT calling install()

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
    });

    await expect(rejected(err)).rejects.toThrow();
  });

  // 17
  it('_retryCount marker is set and incremented on the retry config', async () => {
    const client = createMockClient();
    const retry = createRetry({ count: 3, delay: 0 });
    retry.install(client);

    const configs: RequestConfig[] = [];

    let callCount = 0;
    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      configs.push({ ...config });
      callCount++;
      if (callCount < 3) {
        throw createHttpError({
          code: 'ERR_NETWORK',
          config,
        });
      }
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retry.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: { url: '/api', method: 'GET' },
    });

    const p = rejected(err);
    // Flush all timers to drive the internal retry loop to completion
    await vi.runAllTimersAsync();
    await p;

    // Verify _retryCount was set and incremented on each retry call
    expect(configs).toHaveLength(3);
    expect((configs[0] as Record<string, unknown>)['_retryCount']).toBe(1);
    expect((configs[1] as Record<string, unknown>)['_retryCount']).toBe(2);
    expect((configs[2] as Record<string, unknown>)['_retryCount']).toBe(3);
  });

  // 18
  it('coexists with @parcely/auth-token — auth-token retry does NOT get counted as a retry attempt by @parcely/retry', async () => {
    const client = createMockClient();

    // Install auth-token (it marks retries with _retry: true)
    const auth = createAuthToken({
      getToken: () => 'my-token',
      refresh: async () => 'new-token',
    });
    auth.install(client);

    // Install retry
    const retryHandle = createRetry({ count: 2, delay: 0 });
    retryHandle.install(client);

    // Simulate: auth-token sets _retry: true on a config, but
    // @parcely/retry should only look at _retryCount, not _retry.
    const configWithAuthRetry: RequestConfig & { _retry?: boolean } = {
      url: '/api',
      method: 'GET',
      _retry: true,   // set by auth-token
    };

    // The retry interceptor should still be willing to retry this config
    // because _retryCount is 0 (undefined).
    client._requestImpl = vi.fn(async (config: RequestConfig) => {
      return makeResponse({ data: { ok: true }, config });
    });

    const rejected = retryHandle.response.rejected!;
    const err = createHttpError({
      code: 'ERR_NETWORK',
      config: configWithAuthRetry,
    });

    const resultPromise = rejected(err);
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
    expect(client._requestImpl).toHaveBeenCalledTimes(1);

    // Verify _retryCount was set independently of _retry
    const retryConfig = (client._requestImpl as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    expect(retryConfig['_retryCount']).toBe(1);
    // _retry should still be true (preserved from auth-token)
    expect(retryConfig['_retry']).toBe(true);
  });
});
