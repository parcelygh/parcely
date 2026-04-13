import { describe, it, expect } from 'vitest';
import { mergeConfig } from './config.js';

describe('mergeConfig', () => {
  it('copies only known RequestConfig keys', () => {
    const defaults = { baseURL: 'https://api.example.com' };
    const override = { url: '/users', method: 'GET' } as Record<string, unknown>;
    // Add an unknown key
    override['__unknown_key__'] = 'should not appear';
    const result = mergeConfig(defaults, override as any);
    expect(result.baseURL).toBe('https://api.example.com');
    expect(result.url).toBe('/users');
    expect((result as any).__unknown_key__).toBeUndefined();
  });

  it('override scalar values win over defaults', () => {
    const result = mergeConfig(
      { timeout: 5000, method: 'GET' },
      { timeout: 10000 },
    );
    expect(result.timeout).toBe(10000);
    expect(result.method).toBe('GET');
  });

  it('merges headers from both sources', () => {
    const result = mergeConfig(
      { headers: { 'x-default': '1' } },
      { headers: { 'x-override': '2' } },
    );
    expect(result.headers).toBeDefined();
    const h = result.headers as Record<string, string>;
    expect(h['x-default']).toBe('1');
    expect(h['x-override']).toBe('2');
  });

  it('merges params from both sources (override wins per key)', () => {
    const result = mergeConfig(
      { params: { a: '1', b: '2' } },
      { params: { b: '3', c: '4' } },
    );
    expect(result.params).toEqual({ a: '1', b: '3', c: '4' });
  });

  it('strips __proto__ from nested headers object', () => {
    const headers = Object.create(null) as Record<string, string>;
    headers['x-safe'] = 'ok';
    headers['__proto__'] = 'bad';
    const result = mergeConfig({}, { headers });
    const h = result.headers as Record<string, string>;
    expect(h['x-safe']).toBe('ok');
    // __proto__ should not be an own key on the result
    expect(Object.hasOwn(h, '__proto__')).toBe(false);
  });

  it('strips constructor from nested params object', () => {
    const params: Record<string, unknown> = { good: '1', constructor: 'bad' };
    const result = mergeConfig({}, { params });
    expect(result.params!['good']).toBe('1');
    // constructor should not be an own key on the result
    expect(Object.hasOwn(result.params!, 'constructor')).toBe(false);
  });

  it('strips prototype from nested params object', () => {
    const params: Record<string, unknown> = { good: '1', prototype: 'bad' };
    const result = mergeConfig({}, { params });
    expect(result.params!['good']).toBe('1');
    expect(result.params!['prototype']).toBeUndefined();
  });

  it('does not mutate inputs', () => {
    const defaults = { headers: { 'x-a': '1' }, params: { a: '1' } };
    const override = { headers: { 'x-b': '2' }, params: { b: '2' } };
    const defaultsCopy = JSON.parse(JSON.stringify(defaults));
    const overrideCopy = JSON.parse(JSON.stringify(override));
    mergeConfig(defaults, override);
    expect(defaults).toEqual(defaultsCopy);
    expect(override).toEqual(overrideCopy);
  });
});
