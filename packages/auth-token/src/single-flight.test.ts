import { describe, it, expect, vi } from 'vitest';
import { createSingleFlight } from './single-flight.js';

describe('createSingleFlight', () => {
  it('single call works — invokes fn and resolves with its value', async () => {
    const fn = vi.fn().mockResolvedValue('token-1');
    const flight = createSingleFlight(fn);

    const result = await flight();

    expect(result).toBe('token-1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls share one Promise — fn is invoked only once', async () => {
    let resolveOuter!: (v: string) => void;
    const fn = vi.fn(
      () => new Promise<string>((resolve) => { resolveOuter = resolve; }),
    );
    const flight = createSingleFlight(fn);

    const p1 = flight();
    const p2 = flight();
    const p3 = flight();

    // All three should be the exact same promise reference
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(fn).toHaveBeenCalledTimes(1);

    resolveOuter('shared');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('shared');
    expect(r2).toBe('shared');
    expect(r3).toBe('shared');
  });

  it('after settling, the next call triggers a fresh fn invocation', async () => {
    let callCount = 0;
    const fn = vi.fn(() => Promise.resolve(`call-${++callCount}`));
    const flight = createSingleFlight(fn);

    const first = await flight();
    expect(first).toBe('call-1');

    const second = await flight();
    expect(second).toBe('call-2');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejection also coalesces — concurrent callers all see the same rejection', async () => {
    const error = new Error('refresh failed');
    let rejectOuter!: (e: Error) => void;
    const fn = vi.fn(
      () => new Promise<string>((_, reject) => { rejectOuter = reject; }),
    );
    const flight = createSingleFlight(fn);

    const p1 = flight();
    const p2 = flight();

    expect(p1).toBe(p2);
    expect(fn).toHaveBeenCalledTimes(1);

    rejectOuter(error);

    await expect(p1).rejects.toThrow('refresh failed');
    await expect(p2).rejects.toThrow('refresh failed');
  });

  it('after rejection settles, the next call triggers a fresh fn invocation', async () => {
    let callCount = 0;
    const fn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('fail'));
      }
      return Promise.resolve('success');
    });
    const flight = createSingleFlight(fn);

    await expect(flight()).rejects.toThrow('fail');

    const result = await flight();
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
