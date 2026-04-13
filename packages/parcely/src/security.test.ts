/**
 * Security defense regression suite.
 * One named test per row of the 13-row security-defenses table in the plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildUrl } from './url.js';
import { mergeHeaders } from './headers.js';
import { mergeConfig } from './config.js';
import { redactConfig } from './redact.js';
import { send } from './request.js';
import { createInterceptorChain } from './interceptors.js';
import { HttpError } from './errors.js';
import type { RequestConfig, HttpResponse } from './types.js';
import { installFetchStub, jsonResponse, redirectResponse } from '../test/fetch-stub.js';

function makeContext() {
  return {
    defaults: {} as RequestConfig,
    requestInterceptors: createInterceptorChain<RequestConfig>(),
    responseInterceptors: createInterceptorChain<HttpResponse<unknown>>(),
  };
}

describe('Security Defenses', () => {
  let fetchMock: ReturnType<typeof installFetchStub>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = installFetchStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Row 1: Reject absolute URLs when baseURL is set — CVE-2024-39338, CVE-2025-27152
  it('Row 1: absolute URL rejection (CVE-2024-39338, CVE-2025-27152)', () => {
    // Absolute URL with baseURL set should throw ERR_ABSOLUTE_URL
    expect(() =>
      buildUrl({ baseURL: 'https://api.example.com', url: 'https://evil.com/steal' }),
    ).toThrow(HttpError);

    try {
      buildUrl({ baseURL: 'https://api.example.com', url: 'https://evil.com/steal' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_ABSOLUTE_URL');
    }

    // Protocol-relative URL with baseURL set should also throw
    expect(() =>
      buildUrl({ baseURL: 'https://api.example.com', url: '//evil.com/steal' }),
    ).toThrow(HttpError);
  });

  // Row 2: URI scheme allowlist — blocks file:, data:, javascript:
  it('Row 2: disallowed protocol rejection (file:, data:, javascript:)', () => {
    expect(() => buildUrl({ url: 'file:///etc/passwd' })).toThrow(HttpError);
    try {
      buildUrl({ url: 'file:///etc/passwd' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_DISALLOWED_PROTOCOL');
    }

    expect(() => buildUrl({ url: 'data:text/html,<script>alert(1)</script>' })).toThrow(
      HttpError,
    );
  });

  // Row 3: Cross-origin redirect header stripping
  it('Row 3: cross-origin redirect strips sensitive headers', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://other.com/data', 302))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    await send(
      {
        url: 'https://api.example.com/data',
        headers: { Authorization: 'Bearer secret', Cookie: 'session=abc', Accept: 'text/html' },
      },
      ctx,
    );

    const secondCall = fetchMock.mock.calls[1]!;
    const headers = secondCall[1]?.headers as Headers;
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('accept')).toBe('text/html');
  });

  // Row 4: Manual redirect walk with maxRedirects
  it('Row 4: maxRedirects enforcement (ERR_TOO_MANY_REDIRECTS)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(redirectResponse('https://api.example.com/loop', 302)),
    );

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/start', maxRedirects: 2 }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_TOO_MANY_REDIRECTS');
    }
  });

  // Row 5: Prototype-pollution-safe config merging — CVE-2024-57965
  it('Row 5: prototype pollution defense in config merge (CVE-2024-57965)', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}, "url":"/safe"}');
    const result = mergeConfig({}, malicious);

    // The merged config should not have __proto__ pollution
    expect(result.url).toBe('/safe');
    expect(({} as any).polluted).toBeUndefined();

    // Also test nested objects
    const result2 = mergeConfig(
      {},
      { params: JSON.parse('{"__proto__":{"bad":"true"}, "good":"value"}') },
    );
    expect(result2.params!['good']).toBe('value');
    expect(({} as any).bad).toBeUndefined();
  });

  // Row 6: CRLF injection defense via native Headers API
  it('Row 6: CRLF header injection defense (ERR_CRLF_INJECTION)', () => {
    expect(() =>
      mergeHeaders({ 'x-injected': 'value\r\nEvil-Header: injected' }),
    ).toThrow(HttpError);

    try {
      mergeHeaders({ 'x-injected': 'value\r\nEvil-Header: injected' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_CRLF_INJECTION');
    }
  });

  // Row 7: Optional request header allowlist
  it('Row 7: request header allowlist enforcement (ERR_DISALLOWED_HEADER)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    try {
      await send(
        {
          url: 'https://api.example.com/data',
          headers: { 'X-Not-Allowed': 'val', 'Content-Type': 'application/json' },
          allowedRequestHeaders: ['content-type'],
        },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_DISALLOWED_HEADER');
    }
  });

  // Row 8: Content-type-aware JSON parsing
  it('Row 8: content-type-aware JSON parsing (text/plain does not crash)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('This is plain text', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const ctx = makeContext();
    const result = await send(
      { url: 'https://api.example.com/data', responseType: 'json' },
      ctx,
    );

    // Should return as text, not crash with JSON.parse error
    expect(result.data).toBe('This is plain text');
  });

  // Row 9: Timeout + user signal combined via AbortSignal.any
  it('Row 9: timeout with AbortSignal.any integration', async () => {
    fetchMock.mockImplementation(() =>
      new Promise((_resolve, reject) => {
        setTimeout(
          () => reject(new DOMException('The operation was aborted.', 'TimeoutError')),
          5,
        );
      }),
    );

    const ctx = makeContext();
    try {
      await send({ url: 'https://api.example.com/slow', timeout: 1 }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_TIMEOUT');
    }
  });

  // Row 10: Raw Response never exposed — exhaustively verify NO envelope
  // property (or response.config) is or wraps a fetch Response. A raw Response
  // would let callers re-read the body (double-read errors) or leak streams.
  it('Row 10: raw Response is not exposed in envelope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const ctx = makeContext();
    const result = await send({ url: 'https://api.example.com/data' }, ctx);

    // Top-level envelope shape
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('statusText');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('config');
    expect(result).not.toBeInstanceOf(Response);

    // No envelope property is a Response instance
    for (const value of Object.values(result)) {
      expect(value).not.toBeInstanceOf(Response);
    }

    // The envelope's `config` (and its nested headers/body) is also not a
    // Response — guards against accidental leakage through the redaction path.
    for (const value of Object.values(result.config)) {
      expect(value).not.toBeInstanceOf(Response);
    }

    // `headers` is a native Headers, not a Response
    expect(result.headers).toBeInstanceOf(Headers);

    // The same exhaustive check on a thrown error envelope
    fetchMock.mockResolvedValueOnce(jsonResponse({ err: 'x' }, { status: 500 }));
    try {
      await send({ url: 'https://api.example.com/x' }, ctx);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as HttpError;
      expect(err.response).toBeDefined();
      for (const value of Object.values(err.response!)) {
        expect(value).not.toBeInstanceOf(Response);
      }
    }
  });

  // Row 11: tls.rejectUnauthorized=false emits one-shot console.warn (non-prod).
  // The detailed permutations live in tls.test.ts; here we assert the warn
  // actually fires through the full request pipeline. Without `undici`
  // available in this test process, resolveDispatcher throws an actionable
  // error AFTER firing the insecure-TLS warn — both behaviours are real.
  it('Row 11: TLS rejectUnauthorized=false warns in non-prod', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset the one-shot flag so this test sees a fresh warn regardless of
    // ordering with other tests that touched resolveDispatcher.
    const { _resetTlsWarnings } = await import('./tls.js');
    _resetTlsWarnings();

    // Pin NODE_ENV to development so the warn is allowed to fire.
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const ctx = makeContext();
    try {
      await send(
        {
          url: 'https://api.example.com/data',
          tls: { rejectUnauthorized: false },
        },
        ctx,
      );
    } catch {
      // Expected when undici is not installed in the test runner — the warn
      // still fires before the throw. The genuine integration is covered by
      // scripts/smoke.ts against a real self-signed server.
    } finally {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
    }

    const insecureWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('rejectUnauthorized'),
    );
    expect(insecureWarns).toHaveLength(1);

    warnSpy.mockRestore();
  });

  // Row 12: Sensitive header redaction on envelope & thrown errors
  it('Row 12: sensitive header redaction on responses and errors', async () => {
    // Success case: envelope has redacted config
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ctx = makeContext();
    const result = await send(
      {
        url: 'https://api.example.com/data',
        headers: { Authorization: 'Bearer secret' },
      },
      ctx,
    );

    const h = result.config.headers as Record<string, string>;
    expect(h['authorization']).toBe('[REDACTED]');

    // Error case: thrown HttpError has redacted config
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'denied' }, { status: 403, statusText: 'Forbidden' }),
    );

    try {
      await send(
        {
          url: 'https://api.example.com/secret',
          headers: { Authorization: 'Bearer secret', 'X-API-Key': 'key123' },
        },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as HttpError;
      const errHeaders = err.config.headers as Record<string, string>;
      expect(errHeaders['authorization']).toBe('[REDACTED]');
      expect(errHeaders['x-api-key']).toBe('[REDACTED]');
    }
  });

  // Row 13: Opt-in runtime body validation via validate
  it('Row 13: opt-in runtime validation (ERR_VALIDATION on failure)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));

    const validator = (input: unknown) => {
      const data = input as { id: string };
      if (!data.id) throw new Error('Missing id field');
      return data;
    };

    const ctx = makeContext();
    try {
      await send(
        { url: 'https://api.example.com/data', validate: validator },
        ctx,
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_VALIDATION');
    }
  });
});
