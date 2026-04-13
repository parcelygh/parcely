import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { send } from './request.js';
import { createInterceptorChain } from './interceptors.js';
import { HttpError } from './errors.js';
import type { RequestConfig, HttpResponse } from './types.js';
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
});
