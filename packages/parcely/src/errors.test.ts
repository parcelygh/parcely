import { describe, it, expect } from 'vitest';
import { HttpError, isHttpError } from './errors.js';
import type { RequestConfig, HttpResponse } from './types.js';

function configFixture(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    url: '/users/me',
    baseURL: 'https://api.example.com',
    method: 'GET',
    headers: { Authorization: '[REDACTED]', Accept: 'application/json' },
    timeout: 5_000,
    ...overrides,
  };
}

function responseFixture(): HttpResponse<{ id: string }> {
  return {
    data: { id: 'u_1' },
    status: 418,
    statusText: "I'm a teapot",
    headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'abc' }),
    config: configFixture(),
  };
}

describe('HttpError', () => {
  it('isHttpError narrows correctly', () => {
    const err = new HttpError('boom', { code: 'ERR_NETWORK', config: configFixture() });
    expect(isHttpError(err)).toBe(true);
    expect(isHttpError(new Error('x'))).toBe(false);
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError({ code: 'ERR_NETWORK' })).toBe(false);
  });

  it('carries code / status / config / response / cause', () => {
    const cause = new Error('underlying');
    const err = new HttpError('top', {
      code: 'ERR_HTTP_STATUS',
      status: 418,
      config: configFixture(),
      response: responseFixture(),
      cause,
    });
    expect(err.code).toBe('ERR_HTTP_STATUS');
    expect(err.status).toBe(418);
    expect(err.config.url).toBe('/users/me');
    expect(err.response?.status).toBe(418);
    expect(err.cause).toBe(cause);
  });

  // ---- toJSON() — the new serialisation contract -------------------------

  describe('toJSON', () => {
    it('round-trips cleanly through JSON.stringify', () => {
      const err = new HttpError('Request failed with status 418', {
        code: 'ERR_HTTP_STATUS',
        status: 418,
        config: configFixture(),
        response: responseFixture(),
      });

      // The critical assertion: JSON.stringify must not throw and must not
      // silently swallow the headers.
      const serialised = JSON.stringify(err);
      const parsed = JSON.parse(serialised) as Record<string, unknown>;

      expect(parsed['name']).toBe('HttpError');
      expect(parsed['message']).toBe('Request failed with status 418');
      expect(parsed['code']).toBe('ERR_HTTP_STATUS');
      expect(parsed['status']).toBe(418);
      const config = parsed['config'] as { headers: Record<string, string> };
      expect(config.headers['Accept']).toBe('application/json');
      const response = parsed['response'] as { headers: Record<string, string>; status: number };
      expect(response.status).toBe(418);
      // Response Headers (native instance) survives the round-trip as a flat record.
      expect(response.headers['content-type']).toBe('application/json');
      expect(response.headers['x-request-id']).toBe('abc');
    });

    it('flattens native Headers in config and response', () => {
      const headers = new Headers({ 'X-API-Key': '[REDACTED]' });
      const err = new HttpError('x', {
        code: 'ERR_HTTP_STATUS',
        status: 500,
        config: { ...configFixture(), headers },
        response: { ...responseFixture(), headers: new Headers({ 'cache-control': 'no-store' }) },
      });
      const json = err.toJSON();
      expect(json.config.headers).toEqual({ 'x-api-key': '[REDACTED]' });
      expect(json.response?.headers).toEqual({ 'cache-control': 'no-store' });
    });

    it('reduces `cause` to { name, message, code } — avoids circular refs', () => {
      // Build a cause object with a self-reference. Raw JSON.stringify on
      // `err` without toJSON would throw TypeError on the circular ref.
      const circular: Record<string, unknown> = {
        name: 'FetchError',
        message: 'connect ECONNREFUSED',
        code: 'ECONNREFUSED',
      };
      circular['self'] = circular;

      const err = new HttpError('network', {
        code: 'ERR_NETWORK',
        config: configFixture(),
        cause: circular,
      });

      // This would throw if toJSON didn't normalise the cause.
      const serialised = JSON.stringify(err);
      const parsed = JSON.parse(serialised) as { cause: Record<string, unknown> };
      expect(parsed.cause).toEqual({
        name: 'FetchError',
        message: 'connect ECONNREFUSED',
        code: 'ECONNREFUSED',
      });
      // The `self` back-reference is NOT included.
      expect(parsed.cause['self']).toBeUndefined();
    });

    it('omits `response`, `status`, `cause` when not set', () => {
      const err = new HttpError('parse', {
        code: 'ERR_PARSE',
        config: configFixture(),
      });
      const json = err.toJSON();
      expect(json.response).toBeUndefined();
      expect(json.status).toBeUndefined();
      expect(json.cause).toBeUndefined();
    });

    it('includes stack for local debugging', () => {
      const err = new HttpError('x', { code: 'ERR_NETWORK', config: configFixture() });
      const json = err.toJSON();
      expect(typeof json.stack).toBe('string');
      expect(json.stack).toContain('HttpError');
    });

    it('handles string / primitive causes gracefully', () => {
      const err = new HttpError('x', {
        code: 'ERR_NETWORK',
        config: configFixture(),
        cause: 'raw string cause',
      });
      const json = err.toJSON();
      expect(json.cause).toEqual({ message: 'raw string cause' });
    });

    it('is invoked automatically by JSON.stringify (no manual call needed)', () => {
      // Libraries like pino/winston/console.log ultimately hit toJSON via
      // the Error path. Verify the serialiser finds toJSON on the instance.
      const err = new HttpError('x', {
        code: 'ERR_HTTP_STATUS',
        status: 404,
        config: configFixture(),
      });
      const s = JSON.stringify(err);
      expect(s).toContain('"code":"ERR_HTTP_STATUS"');
      expect(s).toContain('"status":404');
    });
  });
});
