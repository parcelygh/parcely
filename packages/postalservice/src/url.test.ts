import { describe, it, expect } from 'vitest';
import { buildUrl } from './url.js';
import { HttpError } from './errors.js';

describe('buildUrl', () => {
  it('merges baseURL + url', () => {
    const result = buildUrl({ baseURL: 'https://api.example.com', url: '/users' });
    expect(result.href).toBe('https://api.example.com/users');
  });

  it('merges baseURL with trailing slash + url with leading slash', () => {
    const result = buildUrl({ baseURL: 'https://api.example.com/', url: '/users' });
    expect(result.href).toBe('https://api.example.com/users');
  });

  it('handles baseURL without trailing slash + url without leading slash', () => {
    const result = buildUrl({ baseURL: 'https://api.example.com', url: 'users' });
    expect(result.href).toBe('https://api.example.com/users');
  });

  it('handles baseURL with path', () => {
    const result = buildUrl({ baseURL: 'https://api.example.com/v1', url: '/users' });
    expect(result.href).toBe('https://api.example.com/v1/users');
  });

  // params serialization
  it('serializes params via URLSearchParams', () => {
    const result = buildUrl({
      baseURL: 'https://api.example.com',
      url: '/search',
      params: { q: 'hello', page: 1 },
    });
    expect(result.searchParams.get('q')).toBe('hello');
    expect(result.searchParams.get('page')).toBe('1');
  });

  it('serializes array params as repeated keys', () => {
    const result = buildUrl({
      baseURL: 'https://api.example.com',
      url: '/search',
      params: { tags: ['a', 'b', 'c'] },
    });
    expect(result.searchParams.getAll('tags')).toEqual(['a', 'b', 'c']);
  });

  it('skips null and undefined param values', () => {
    const result = buildUrl({
      baseURL: 'https://api.example.com',
      url: '/search',
      params: { q: 'hello', page: null, limit: undefined },
    });
    expect(result.searchParams.has('page')).toBe(false);
    expect(result.searchParams.has('limit')).toBe(false);
  });

  it('URL-encodes special characters in params', () => {
    const result = buildUrl({
      baseURL: 'https://api.example.com',
      url: '/search',
      params: { q: 'hello world&more' },
    });
    expect(result.href).toContain('q=hello+world%26more');
  });

  // absolute URL rejection
  it('rejects absolute URLs when baseURL is set (default allowAbsoluteUrls = false)', () => {
    expect(() =>
      buildUrl({ baseURL: 'https://api.example.com', url: 'https://evil.com/data' }),
    ).toThrow(HttpError);

    try {
      buildUrl({ baseURL: 'https://api.example.com', url: 'https://evil.com/data' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_ABSOLUTE_URL');
    }
  });

  // protocol-relative rejection
  it('rejects protocol-relative URLs (//host/path) when baseURL is set', () => {
    expect(() =>
      buildUrl({ baseURL: 'https://api.example.com', url: '//evil.com/data' }),
    ).toThrow(HttpError);

    try {
      buildUrl({ baseURL: 'https://api.example.com', url: '//evil.com/data' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_ABSOLUTE_URL');
    }
  });

  it('allows absolute URLs when allowAbsoluteUrls is true', () => {
    const result = buildUrl({
      baseURL: 'https://api.example.com',
      url: 'https://other.com/data',
      allowAbsoluteUrls: true,
    });
    expect(result.href).toBe('https://other.com/data');
  });

  // allowedProtocols enforcement
  it('rejects disallowed protocols', () => {
    expect(() =>
      buildUrl({ url: 'file:///etc/passwd', allowedProtocols: ['http:', 'https:'] }),
    ).toThrow(HttpError);

    try {
      buildUrl({ url: 'file:///etc/passwd' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_DISALLOWED_PROTOCOL');
    }
  });

  it('rejects data: protocol by default', () => {
    expect(() => buildUrl({ url: 'data:text/html,<script>alert(1)</script>' })).toThrow(
      HttpError,
    );
  });

  it('allows custom protocols when configured', () => {
    const result = buildUrl({
      url: 'custom://server/path',
      allowedProtocols: ['custom:'],
    });
    expect(result.protocol).toBe('custom:');
  });

  it('works without baseURL for absolute URLs', () => {
    const result = buildUrl({ url: 'https://api.example.com/users' });
    expect(result.href).toBe('https://api.example.com/users');
  });
});
