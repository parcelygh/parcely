import { describe, it, expect } from 'vitest';
import { deriveKey } from './keys.js';

describe('deriveKey', () => {
  it('produces stable serialization (same input = same key)', () => {
    const a = deriveKey('GET', '/users', { page: 1 });
    const b = deriveKey('GET', '/users', { page: 1 });
    expect(a).toBe(b);
  });

  it('sorts param keys alphabetically', () => {
    const a = deriveKey('GET', '/users', { b: 1, a: 2 });
    const b = deriveKey('GET', '/users', { a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('treats undefined/missing params as {}', () => {
    const a = deriveKey('GET', '/users');
    const b = deriveKey('GET', '/users', undefined);
    expect(a).toBe(b);
    // Both should contain '{}' as the serialized params
    expect(a).toContain('{}');
  });

  it('produces different keys for different URLs', () => {
    const a = deriveKey('GET', '/users');
    const b = deriveKey('GET', '/posts');
    expect(a).not.toBe(b);
  });

  it('produces different keys for different methods', () => {
    const a = deriveKey('GET', '/users');
    const b = deriveKey('POST', '/users');
    expect(a).not.toBe(b);
  });

  it('uppercases the method', () => {
    const a = deriveKey('get', '/users');
    const b = deriveKey('GET', '/users');
    expect(a).toBe(b);
  });

  it('returns a JSON array string', () => {
    const key = deriveKey('GET', '/users', { page: 1 });
    const parsed = JSON.parse(key) as unknown[];
    expect(parsed).toEqual(['parcely', 'GET', '/users', '{"page":1}']);
  });
});
