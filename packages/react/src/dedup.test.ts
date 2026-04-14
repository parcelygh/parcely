import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HttpResponse } from '@parcely/core';
import { fetchOrDedup, clearInflight } from './dedup.js';

function makeResponse<T>(data: T): HttpResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config: {},
  };
}

describe('fetchOrDedup', () => {
  beforeEach(() => {
    clearInflight();
  });

  it('concurrent calls with the same key share one promise', async () => {
    const fn = vi.fn(() => Promise.resolve(makeResponse('ok')));
    const p1 = fetchOrDedup('key-a', fn);
    const p2 = fetchOrDedup('key-a', fn);
    expect(p1).toBe(p2);
    expect(fn).toHaveBeenCalledTimes(1);
    await p1;
  });

  it('settle (resolve) clears the entry — next call triggers new fetch', async () => {
    const fn = vi.fn(() => Promise.resolve(makeResponse('ok')));
    const p1 = fetchOrDedup('key-b', fn);
    await p1;
    // Entry should be cleared now
    const p2 = fetchOrDedup('key-b', fn);
    expect(p2).not.toBe(p1);
    expect(fn).toHaveBeenCalledTimes(2);
    await p2;
  });

  it('error settle clears the entry too', async () => {
    const err = new Error('fail');
    const fn = vi.fn(() => Promise.reject(err));
    const p1 = fetchOrDedup('key-c', fn);
    await expect(p1).rejects.toThrow('fail');
    // Entry should be cleared now
    const fn2 = vi.fn(() => Promise.resolve(makeResponse('ok')));
    const p2 = fetchOrDedup('key-c', fn2);
    expect(fn2).toHaveBeenCalledTimes(1);
    await p2;
  });

  it('different keys do not dedup', async () => {
    const fn1 = vi.fn(() => Promise.resolve(makeResponse('a')));
    const fn2 = vi.fn(() => Promise.resolve(makeResponse('b')));
    const p1 = fetchOrDedup('key-x', fn1);
    const p2 = fetchOrDedup('key-y', fn2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    await Promise.all([p1, p2]);
  });
});
