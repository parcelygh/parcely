import { describe, it, expect } from 'vitest';
import { mergeHeaders, enforceAllowedHeaders } from './headers.js';
import { HttpError } from './errors.js';

describe('mergeHeaders', () => {
  it('merges multiple plain-object sources (right wins)', () => {
    const h = mergeHeaders({ 'x-a': '1' }, { 'x-a': '2', 'x-b': '3' });
    expect(h.get('x-a')).toBe('2');
    expect(h.get('x-b')).toBe('3');
  });

  it('merges Headers instances', () => {
    const a = new Headers({ 'x-a': '1' });
    const b = new Headers({ 'x-a': '2' });
    const h = mergeHeaders(a, b);
    expect(h.get('x-a')).toBe('2');
  });

  it('merges tuple arrays', () => {
    const h = mergeHeaders([['x-a', '1']], [['x-a', '2']]);
    expect(h.get('x-a')).toBe('2');
  });

  it('is case-insensitive', () => {
    const h = mergeHeaders({ 'Content-Type': 'text/plain' }, { 'content-type': 'application/json' });
    expect(h.get('content-type')).toBe('application/json');
  });

  it('strips __proto__ key', () => {
    const h = mergeHeaders({ __proto__: 'bad', 'x-safe': 'ok' } as Record<string, string>);
    expect(h.get('x-safe')).toBe('ok');
    // __proto__ should not be set
    expect(h.get('__proto__')).toBeNull();
  });

  it('strips constructor key', () => {
    const h = mergeHeaders({ constructor: 'bad', 'x-safe': 'ok' });
    expect(h.get('constructor')).toBeNull();
  });

  it('strips prototype key', () => {
    const h = mergeHeaders({ prototype: 'bad', 'x-safe': 'ok' });
    expect(h.get('prototype')).toBeNull();
  });

  it('handles undefined sources gracefully', () => {
    const h = mergeHeaders(undefined, { 'x-a': '1' }, undefined);
    expect(h.get('x-a')).toBe('1');
  });

  it('rejects CRLF in header values with ERR_CRLF_INJECTION', () => {
    expect(() =>
      mergeHeaders({ 'x-bad': 'value\r\nInjected: header' }),
    ).toThrow(HttpError);

    try {
      mergeHeaders({ 'x-bad': 'value\r\nInjected: header' });
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_CRLF_INJECTION');
    }
  });

  it('rejects lone \\n in header values', () => {
    expect(() =>
      mergeHeaders({ 'x-bad': 'value\nInjected: header' }),
    ).toThrow(HttpError);
  });
});

describe('enforceAllowedHeaders', () => {
  it('allows headers in the allowlist', () => {
    const h = new Headers({ 'content-type': 'application/json', accept: 'text/html' });
    expect(() => enforceAllowedHeaders(h, ['content-type', 'accept'], {})).not.toThrow();
  });

  it('throws ERR_DISALLOWED_HEADER for headers not in allowlist', () => {
    const h = new Headers({ 'content-type': 'application/json', 'x-custom': 'val' });
    expect(() =>
      enforceAllowedHeaders(h, ['content-type'], {}),
    ).toThrow(HttpError);

    try {
      enforceAllowedHeaders(h, ['content-type'], {});
    } catch (e) {
      expect((e as HttpError).code).toBe('ERR_DISALLOWED_HEADER');
    }
  });

  it('is case-insensitive in allowlist matching', () => {
    const h = new Headers({ 'Content-Type': 'application/json' });
    expect(() =>
      enforceAllowedHeaders(h, ['CONTENT-TYPE'], {}),
    ).not.toThrow();
  });

  it('does nothing when allowlist is undefined', () => {
    const h = new Headers({ 'x-anything': 'val' });
    expect(() => enforceAllowedHeaders(h, undefined, {})).not.toThrow();
  });
});
