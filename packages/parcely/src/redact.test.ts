import { describe, it, expect } from 'vitest';
import { redactConfig } from './redact.js';

describe('redactConfig', () => {
  it('redacts default sensitive headers (case-insensitive)', () => {
    const config = {
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        Cookie: 'session=abc',
      },
    };
    const result = redactConfig(config);
    const h = result.headers as Record<string, string>;
    expect(h['Authorization']).toBe('[REDACTED]');
    expect(h['Cookie']).toBe('[REDACTED]');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('redacts x-api-key by default', () => {
    const config = { headers: { 'X-API-Key': 'my-key' } };
    const result = redactConfig(config);
    const h = result.headers as Record<string, string>;
    expect(h['X-API-Key']).toBe('[REDACTED]');
  });

  it('supports custom sensitive list', () => {
    const config = { headers: { 'X-Custom': 'secret', Authorization: 'keep' } };
    const result = redactConfig(config, ['x-custom']);
    const h = result.headers as Record<string, string>;
    expect(h['X-Custom']).toBe('[REDACTED]');
    expect(h['Authorization']).toBe('keep');
  });

  it('does not mutate the original config', () => {
    const config = {
      headers: { Authorization: 'Bearer secret' },
      baseURL: 'https://api.example.com',
    };
    const original = { ...config, headers: { ...config.headers } };
    redactConfig(config);
    expect(config.headers.Authorization).toBe('Bearer secret');
    expect(config).toEqual(original);
  });

  it('handles Headers instances', () => {
    const config = {
      headers: new Headers({ Authorization: 'Bearer token', Accept: 'text/html' }),
    };
    const result = redactConfig(config);
    expect(result.headers).toBeInstanceOf(Headers);
    expect((result.headers as Headers).get('authorization')).toBe('[REDACTED]');
    expect((result.headers as Headers).get('accept')).toBe('text/html');
  });

  it('handles tuple-array headers', () => {
    const config = {
      headers: [
        ['Authorization', 'Bearer token'],
        ['Accept', 'text/html'],
      ] as [string, string][],
    };
    const result = redactConfig(config);
    const h = result.headers as [string, string][];
    expect(h.find(([k]) => k === 'Authorization')?.[1]).toBe('[REDACTED]');
    expect(h.find(([k]) => k === 'Accept')?.[1]).toBe('text/html');
  });

  it('returns config as-is if no headers', () => {
    const config = { baseURL: 'https://api.example.com', method: 'GET' };
    const result = redactConfig(config);
    expect(result.baseURL).toBe('https://api.example.com');
    expect(result.headers).toBeUndefined();
  });
});
