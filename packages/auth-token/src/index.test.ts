import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthToken } from './index.js';
import type {
  Client,
  RequestConfig,
  HttpResponse,
  InterceptorHandler,
} from '@parcely/core';

// ---------------------------------------------------------------------------
// Mock Client factory
// ---------------------------------------------------------------------------

interface MockInterceptorManager<T> {
  use(
    handler: InterceptorHandler<T>,
  ): number;
  use(
    onFulfilled?: (value: T) => T | Promise<T>,
    onRejected?: (err: unknown) => unknown,
  ): number;
  eject(id: number): void;
  /** Internal: collected handlers for test assertions */
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
}): Error & { code: string; status?: number | undefined; config?: RequestConfig | undefined } {
  const err = new Error(opts.message ?? 'Request failed') as Error & {
    code: string;
    status?: number | undefined;
    config?: RequestConfig | undefined;
  };
  err.code = opts.code;
  if (opts.status !== undefined) {
    err.status = opts.status;
  }
  err.config = opts.config ?? { url: '/test' };
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAuthToken', () => {
  // ---- Request interceptor ------------------------------------------------

  describe('request interceptor', () => {
    it('attaches static token with default scheme and header', async () => {
      const auth = createAuthToken({ getToken: () => 'my-token' });

      const config = await auth.request({ url: '/api' });

      expect(config.headers).toBeDefined();
      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('attaches async token', async () => {
      const auth = createAuthToken({
        getToken: async () => 'async-token',
      });

      const config = await auth.request({ url: '/api' });

      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer async-token');
    });

    it('uses custom scheme ("Basic")', async () => {
      const auth = createAuthToken({
        scheme: 'Basic',
        getToken: () => 'dXNlcjpwYXNz',
      });

      const config = await auth.request({ url: '/api' });

      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
    });

    it('uses custom scheme ("Token")', async () => {
      const auth = createAuthToken({
        scheme: 'Token',
        getToken: () => 'abc123',
      });

      const config = await auth.request({ url: '/api' });

      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Token abc123');
    });

    it('empty string scheme sends raw token', async () => {
      const auth = createAuthToken({
        scheme: '',
        getToken: () => 'raw-token',
      });

      const config = await auth.request({ url: '/api' });

      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('raw-token');
    });

    it('uses custom header ("X-API-Key")', async () => {
      const auth = createAuthToken({
        header: 'X-API-Key',
        scheme: '',
        getToken: () => 'key-123',
      });

      const config = await auth.request({ url: '/api' });

      const headers = config.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('key-123');
    });

    it('does not overwrite caller-supplied header (Record)', async () => {
      const auth = createAuthToken({ getToken: () => 'my-token' });

      const config = await auth.request({
        url: '/api',
        headers: { Authorization: 'Custom xyz' },
      });

      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Custom xyz');
    });

    it('does not overwrite caller-supplied header (Headers instance)', async () => {
      const auth = createAuthToken({ getToken: () => 'my-token' });
      const h = new Headers();
      h.set('Authorization', 'Custom xyz');

      const config = await auth.request({ url: '/api', headers: h });

      // When header already present, the config is returned as-is
      expect(config.headers).toBe(h);
    });

    it('does not overwrite caller-supplied header (tuple array)', async () => {
      const auth = createAuthToken({ getToken: () => 'my-token' });

      const config = await auth.request({
        url: '/api',
        headers: [['authorization', 'Custom xyz']],
      });

      // Header was already set, so config is returned unchanged
      expect(config.headers).toEqual([['authorization', 'Custom xyz']]);
    });

    it('does not set header when getToken returns null', async () => {
      const auth = createAuthToken({ getToken: () => null });

      const config = await auth.request({ url: '/api' });

      // headers should be unchanged (undefined in this case)
      expect(config.headers).toBeUndefined();
    });

    it('skips getToken on retry config (_retry: true) — preserves caller-supplied header', async () => {
      // The response interceptor sets `_retry: true` and writes the freshly
      // refreshed token onto config.headers before re-issuing the request.
      // The request interceptor must NOT call getToken() again — otherwise
      // it could read a stale token from the user's store (race against the
      // just-completed refresh) and clobber the new header.
      let getTokenCalls = 0;
      const auth = createAuthToken({
        getToken: () => {
          getTokenCalls++;
          return 'STALE_TOKEN';
        },
      });

      const config = await auth.request({
        url: '/api',
        headers: { Authorization: 'Bearer FRESH_TOKEN' },
        // marker the response-error interceptor sets on retry
        _retry: true,
      } as RequestConfig & { _retry: boolean });

      expect(getTokenCalls).toBe(0);
      const headers = config.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer FRESH_TOKEN');
    });
  });

  // ---- Response error interceptor -----------------------------------------

  describe('response error interceptor — no refresh', () => {
    it('401 propagates when refresh is not provided', async () => {
      const auth = createAuthToken({ getToken: () => 'tok' });

      // No response.rejected when refresh is not provided
      expect(auth.response.rejected).toBeUndefined();
    });
  });

  describe('response error interceptor — with refresh', () => {
    let refreshMock: ReturnType<typeof vi.fn>;
    let client: MockClient;

    beforeEach(() => {
      refreshMock = vi.fn().mockResolvedValue('new-token');
      client = createMockClient();
    });

    it('401 triggers refresh, then retries with new token', async () => {
      const auth = createAuthToken({
        getToken: () => 'old-token',
        refresh: refreshMock,
      });
      auth.install(client);

      // Simulate retry succeeding
      client._requestImpl = vi.fn().mockResolvedValue({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config: { url: '/api' },
      });

      const err = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api', method: 'GET' },
      });

      const rejected = auth.response.rejected!;
      const result = await rejected(err);

      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(client._requestImpl).toHaveBeenCalledTimes(1);

      // Verify the retry config has the new token and _retry marker
      const retryConfig = (client._requestImpl as ReturnType<typeof vi.fn>)
        .mock.calls[0]![0] as RequestConfig & { _retry?: boolean };
      const headers = retryConfig.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer new-token');
      expect(retryConfig._retry).toBe(true);

      expect((result as HttpResponse<unknown>).data).toEqual({ ok: true });
    });

    it('concurrent 401s trigger a single refresh call', async () => {
      let resolveRefresh!: (v: string) => void;
      const slowRefresh = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      const auth = createAuthToken({
        getToken: () => 'old-token',
        refresh: slowRefresh,
      });
      auth.install(client);

      client._requestImpl = vi.fn().mockResolvedValue({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config: { url: '/api' },
      });

      const err1 = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api/1' },
      });
      const err2 = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api/2' },
      });
      const err3 = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api/3' },
      });

      const rejected = auth.response.rejected!;

      // Fire three concurrent rejections
      const p1 = rejected(err1);
      const p2 = rejected(err2);
      const p3 = rejected(err3);

      // Refresh should only have been called once
      expect(slowRefresh).toHaveBeenCalledTimes(1);

      resolveRefresh('fresh-token');

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      // All three retried
      expect(client._requestImpl).toHaveBeenCalledTimes(3);
      expect((r1 as HttpResponse<unknown>).status).toBe(200);
      expect((r2 as HttpResponse<unknown>).status).toBe(200);
      expect((r3 as HttpResponse<unknown>).status).toBe(200);
    });

    it('retry is bounded to one level — retried 401 propagates', async () => {
      const auth = createAuthToken({
        getToken: () => 'old-token',
        refresh: refreshMock,
      });
      auth.install(client);

      const err = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api', _retry: true } as RequestConfig & {
          _retry: boolean;
        },
      });

      const rejected = auth.response.rejected!;

      await expect(rejected(err)).rejects.toThrow();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('refresh itself rejects — original error propagates', async () => {
      const failingRefresh = vi
        .fn()
        .mockRejectedValue(new Error('refresh-network-error'));

      const auth = createAuthToken({
        getToken: () => 'old-token',
        refresh: failingRefresh,
      });
      auth.install(client);

      const originalError = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 401,
        config: { url: '/api' },
        message: 'Unauthorized',
      });

      const rejected = auth.response.rejected!;

      try {
        await rejected(originalError);
        expect.fail('should have thrown');
      } catch (thrown) {
        // The ORIGINAL error should propagate, not the refresh error
        expect(thrown).toBe(originalError);
      }
    });

    it('refreshOn customization — responds to [401, 419]', async () => {
      const auth = createAuthToken({
        getToken: () => 'tok',
        refresh: refreshMock,
        refreshOn: [401, 419],
      });
      auth.install(client);

      client._requestImpl = vi.fn().mockResolvedValue({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        config: { url: '/api' },
      });

      // 419 should trigger refresh
      const err419 = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 419,
        config: { url: '/api' },
      });

      const rejected = auth.response.rejected!;
      await rejected(err419);

      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it('non-matching status code propagates without refresh', async () => {
      const auth = createAuthToken({
        getToken: () => 'tok',
        refresh: refreshMock,
      });
      auth.install(client);

      const err = createHttpError({
        code: 'ERR_HTTP_STATUS',
        status: 500,
        config: { url: '/api' },
      });

      const rejected = auth.response.rejected!;

      await expect(rejected(err)).rejects.toThrow();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('non-HttpError errors propagate without refresh', async () => {
      const auth = createAuthToken({
        getToken: () => 'tok',
        refresh: refreshMock,
      });
      auth.install(client);

      const rejected = auth.response.rejected!;

      await expect(rejected(new Error('generic'))).rejects.toThrow('generic');
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('error with code !== ERR_HTTP_STATUS propagates without refresh', async () => {
      const auth = createAuthToken({
        getToken: () => 'tok',
        refresh: refreshMock,
      });
      auth.install(client);

      const err = createHttpError({
        code: 'ERR_NETWORK',
        config: { url: '/api' },
      });

      const rejected = auth.response.rejected!;

      await expect(rejected(err)).rejects.toThrow();
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  // ---- install() ----------------------------------------------------------

  describe('install()', () => {
    it('registers both interceptors on the client', () => {
      const auth = createAuthToken({
        getToken: () => 'tok',
        refresh: async () => 'new',
      });
      const client = createMockClient();

      auth.install(client);

      expect(client.interceptors.request._handlers).toHaveLength(1);
      expect(
        client.interceptors.request._handlers[0]!.fulfilled,
      ).toBe(auth.request);
      expect(client.interceptors.response._handlers).toHaveLength(1);
      expect(
        client.interceptors.response._handlers[0]!.rejected,
      ).toBe(auth.response.rejected);
    });

    it('registers only request interceptor when no refresh provided', () => {
      const auth = createAuthToken({ getToken: () => 'tok' });
      const client = createMockClient();

      auth.install(client);

      expect(client.interceptors.request._handlers).toHaveLength(1);
      expect(client.interceptors.response._handlers).toHaveLength(1);
      // rejected is undefined when no refresh
      expect(
        client.interceptors.response._handlers[0]!.rejected,
      ).toBeUndefined();
    });
  });
});
