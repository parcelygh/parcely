import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRetryAfter, computeDelay, sleep } from './backoff.js';

// ---------------------------------------------------------------------------
// parseRetryAfter
// ---------------------------------------------------------------------------

describe('parseRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses integer seconds — "30" → 30_000 ms', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('parses zero — "0" → 0 ms', () => {
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date — returns correct ms delta, clamped at maxDelayMs by caller', () => {
    // Set the fake clock to a known time
    vi.setSystemTime(new Date('2026-10-21T07:27:00.000Z'));

    // Retry-After header is 60 seconds into the future
    const result = parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(result).toBe(60_000);
  });

  it('parses HTTP-date in the past — returns 0 (retry immediately)', () => {
    vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'));

    const result = parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(result).toBe(0);
  });

  it('returns undefined for non-parseable string — "not-a-number"', () => {
    expect(parseRetryAfter('not-a-number')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseRetryAfter('')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeDelay
// ---------------------------------------------------------------------------

describe('computeDelay', () => {
  it('exponential-backoff progression with jitter stays within expected bounds', () => {
    const base = 300;
    const max = 30_000;

    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = computeDelay(attempt, base, max);
      const upperBound = Math.min(base * Math.pow(2, attempt), max);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(upperBound);
    }
  });

  it('respects maxDelayMs cap on high attempts', () => {
    const maxDelay = 5000;
    // Attempt 20 would be 300 * 2^20 = 314_572_800 without cap
    for (let i = 0; i < 50; i++) {
      const delay = computeDelay(20, 300, maxDelay);
      expect(delay).toBeLessThanOrEqual(maxDelay);
    }
  });

  it('uses default values when base and max are omitted', () => {
    const delay = computeDelay(1);
    // With defaults: base=300, max=30000, attempt=1 → cap = min(600, 30000) = 600
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(600);
  });
});

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the specified ms', async () => {
    const p = sleep(1000);
    let resolved = false;
    void p.then(() => { resolved = true; });

    // Not resolved yet
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it('rejects with AbortError if signal is aborted mid-sleep', async () => {
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);

    // Abort after 100ms
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    await expect(p).rejects.toThrow();
  });

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const p = sleep(5000, controller.signal);

    await expect(p).rejects.toThrow();
  });

  it('resolves normally when no signal is provided', async () => {
    const p = sleep(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
  });
});
