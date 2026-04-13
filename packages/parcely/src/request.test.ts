import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { send } from './request.js';
import { createInterceptorChain } from './interceptors.js';
import { HttpError } from './errors.js';
import type { RequestConfig, HttpResponse, HeadersInit } from './types.js';
import {
  installFetchStub,
  jsonResponse,
  textResponse,
  redirectResponse,
} from '../test/fetch-stub.js';

function makeContext() {
  return {
    defaults: {} as RequestConfig,
    requestInterceptors: createInterceptorChain<RequestConfig>(),
    responseInterceptors: createInterceptorChain<HttpResponse<unknown>>(),
  };
}

describe('send', () => {
  let fetchMock: ReturnType<typeof installFetchStub>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = installFetchStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('happy path: returns envelope with data, status, headers, config', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Test' }));

    const ctx = makeContext();
    const result = await send<{ id: number; name: string }>(
      { url: 'https://api.example.com/users/1', method: 'GET' },
      ctx,
    );

    expect(result.data).toEqual({ id: 1, name: 'Test' });
    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.config).toBeDefined();
  });

  it('non-2xx throws ERR_HTTP_STATUS with envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' }),
    );

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/users/999', method: 'GET' }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      const err = e as HttpError;
      expect(err.code).toBe('ERR_HTTP_STATUS');
      expect(err.status).toBe(404);
      expect(err.response).toBeDefined();
      expect(err.response?.data).toEqual({ error: 'not found' });
    }
  });

  it('timeout fires ERR_TIMEOUT', async () => {
    fetchMock.mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        const err = new DOMException('The operation was aborted.', 'TimeoutError');
        // Simulate the timeout signal firing
        setTimeout(() => reject(err), 5);
      });
    });

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/slow', timeout: 1 }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('ERR_TIMEOUT');
    }
  });

  it('user abort fires ERR_ABORTED', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchMock.mockImplementation(() => {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    const ctx = makeContext();
    try {
      await send(
        { url: 'https://api.example.com/data', signal: controller.signal },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('ERR_ABORTED');
    }
  });

  it('cross-origin redirect strips Authorization', async () => {
    // First request returns redirect to different origin
    fetchMock
      .mockResolvedValueOnce(
        redirectResponse('https://other.com/api/data', 302),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    await send(
      {
        url: 'https://api.example.com/data',
        method: 'GET',
        headers: { Authorization: 'Bearer secret', Accept: 'application/json' },
      },
      ctx,
    );

    // Second fetch call should NOT have Authorization
    const secondCall = fetchMock.mock.calls[1]!;
    const headers = secondCall[1]?.headers as Headers;
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });

  it('manual redirect loop respects maxRedirects', async () => {
    // Return redirects forever
    fetchMock.mockImplementation(() =>
      Promise.resolve(redirectResponse('https://api.example.com/loop', 302)),
    );

    const ctx = makeContext();
    try {
      await send(
        { url: 'https://api.example.com/start', maxRedirects: 3 },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('ERR_TOO_MANY_REDIRECTS');
    }
    // 1 original + 3 redirects = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('validate hook runs post-parse', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Test' }));

    const validator = vi.fn((input: unknown) => {
      const data = input as { id: number; name: string };
      return { ...data, validated: true };
    });

    const ctx = makeContext();
    const result = await send(
      {
        url: 'https://api.example.com/users/1',
        validate: validator,
      },
      ctx,
    );

    expect(validator).toHaveBeenCalledWith({ id: 1, name: 'Test' });
    expect(result.data).toEqual({ id: 1, name: 'Test', validated: true });
  });

  it('network error throws ERR_NETWORK', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/data' }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('ERR_NETWORK');
    }
  });

  it('redacts sensitive headers in error config', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' }),
    );

    const ctx = makeContext();
    try {
      await send(
        {
          url: 'https://api.example.com/secret',
          headers: { Authorization: 'Bearer secret123' },
        },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as HttpError;
      const h = err.config.headers as Record<string, string>;
      expect(h['authorization']).toBe('[REDACTED]');
    }
  });

  it('falls back to text when content-type is not JSON-ish', async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse('plain text body'),
    );

    const ctx = makeContext();
    const result = await send(
      { url: 'https://api.example.com/text', responseType: 'json' },
      ctx,
    );

    expect(result.data).toBe('plain text body');
  });

  it('same-origin redirect preserves Authorization', async () => {
    fetchMock
      .mockResolvedValueOnce(
        redirectResponse('https://api.example.com/v2/data', 302),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    await send(
      {
        url: 'https://api.example.com/data',
        headers: { Authorization: 'Bearer keep' },
      },
      ctx,
    );

    const secondCall = fetchMock.mock.calls[1]!;
    const headers = secondCall[1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer keep');
  });

  // ---- Edge cases the v1 review flagged as missing -------------------------

  it('rejects redirects to disallowed protocols (file://) with ERR_DISALLOWED_PROTOCOL', async () => {
    // 302 from https:// to file:///etc/passwd — must throw before fetching
    // the redirect target. Without the per-redirect protocol re-check, this
    // would have silently been delegated to fetch's runtime handling.
    fetchMock
      .mockResolvedValueOnce(redirectResponse('file:///etc/passwd', 302));

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/start' }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_DISALLOWED_PROTOCOL');
    }
    // Critically — the second fetch must NOT have been issued.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves method and re-prepares body on 307/308 redirects', async () => {
    // 308 Permanent Redirect must keep POST and re-send the body.
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://api.example.com/v2/upload', 308))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    await send(
      {
        url: 'https://api.example.com/upload',
        method: 'POST',
        body: { hello: 'world' },
      },
      ctx,
    );

    const secondCall = fetchMock.mock.calls[1]!;
    expect(secondCall[1]?.method).toBe('POST');
    // Body must be present on the re-issued request, not stripped.
    expect(secondCall[1]?.body).toBeDefined();
  });

  it('re-prepares FormData body on 307 redirect (one-shot stream guard)', async () => {
    // FormData materialises via `new Response(formData).body`, a one-shot
    // ReadableStream. Without re-preparation, the second fetch would receive
    // an exhausted stream. Verify a fresh body shows up.
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://api.example.com/v2/up', 307))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    const fd = new FormData();
    fd.append('field', 'value');
    fd.append('file', new Blob(['contents'], { type: 'text/plain' }), 'a.txt');

    await send(
      {
        url: 'https://api.example.com/up',
        method: 'POST',
        body: fd,
      },
      ctx,
    );

    const secondCall = fetchMock.mock.calls[1]!;
    expect(secondCall[1]?.method).toBe('POST');
    // The body must be a fresh non-undefined value (a new ReadableStream
    // produced by re-running prepareBody on the original FormData).
    expect(secondCall[1]?.body).toBeDefined();
    // And we must be able to read it — i.e. it is not a consumed stream.
    const replayed = await new Response(
      secondCall[1]?.body as ReadableStream,
      { headers: { 'content-type': secondCall[1]?.headers
          ? (secondCall[1]?.headers as Headers).get('content-type') ?? ''
          : '' } },
    ).text();
    expect(replayed.length).toBeGreaterThan(0);
  });

  it('responseType: "stream" returns the un-consumed ReadableStream as data', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('streamed-body-bytes'));

    const ctx = makeContext();
    const result = await send({
      url: 'https://api.example.com/big',
      responseType: 'stream',
    }, ctx);

    expect(result.data).toBeInstanceOf(ReadableStream);
    // The user can drain it themselves.
    const drained = await new Response(result.data as ReadableStream).text();
    expect(drained).toBe('streamed-body-bytes');
  });

  it('stream responseType skips validate (cannot inspect bytes pre-read)', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('opaque'));

    let validatorCalled = false;
    const validator = (input: unknown): unknown => {
      validatorCalled = true;
      return input;
    };

    const ctx = makeContext();
    const result = await send({
      url: 'https://api.example.com/x',
      responseType: 'stream',
      validate: validator,
    }, ctx);

    expect(validatorCalled).toBe(false);
    expect(result.data).toBeInstanceOf(ReadableStream);
  });

  it('concurrent requests on one client do not cross-contaminate config or headers', async () => {
    // Fan out 50 in-flight requests, each with distinct headers, body, and a
    // request-interceptor mutation. The envelope returned for each must
    // reflect THAT request's config — no leakage from sibling requests
    // through the shared chain or any mutable internal state.
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const headers = init.headers as Headers;
      const seen = headers.get('x-request-id') ?? 'none';
      // Echo the marker so we can prove which request hit fetch.
      return Promise.resolve(jsonResponse({ url, seen }));
    });

    const ctx = makeContext();
    // Add a request interceptor that stamps the URL into a header. If the
    // interceptor or merge somehow shared state, request N would see
    // request N+1's URL or vice versa.
    ctx.requestInterceptors.use(async (config) => {
      const h = new Headers((config.headers as HeadersInit) ?? {});
      h.set('x-request-id', config.url ?? 'unknown');
      return { ...config, headers: h };
    });

    const promises = Array.from({ length: 50 }, (_, i) =>
      send<{ url: string; seen: string }>(
        { url: `https://api.example.com/r${i}` },
        ctx,
      ),
    );

    const results = await Promise.all(promises);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      expect(r.data.seen).toBe(`https://api.example.com/r${i}`);
      // The envelope's redacted config also points at the right URL.
      expect(r.config.url).toBe(`https://api.example.com/r${i}`);
    }
  });

  it('AbortSignal.any: simultaneous user-abort + timeout produces a single error', async () => {
    // Race the user signal and the timeout — both fire before fetch resolves.
    // The combined signal should abort fetch and we should get exactly one
    // HttpError (not a hung promise, not double-throw).
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const ctx = makeContext();
    const controller = new AbortController();
    // Schedule both to fire at roughly the same tick.
    setTimeout(() => controller.abort(), 1);

    let errorCount = 0;
    let result: unknown;
    try {
      result = await send(
        {
          url: 'https://api.example.com/x',
          signal: controller.signal,
          timeout: 1,
        },
        ctx,
      );
    } catch (e) {
      errorCount++;
      result = e;
    }

    // Exactly one error, classified as either ABORTED (user signal) or
    // TIMEOUT — both are valid winners of the race. The test guards against
    // the failure modes "promise hangs" and "throws twice".
    expect(errorCount).toBe(1);
    expect(result).toBeInstanceOf(HttpError);
    const code = (result as HttpError).code;
    expect(['ERR_ABORTED', 'ERR_TIMEOUT']).toContain(code);
  });
});
