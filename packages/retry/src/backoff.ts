// ---------------------------------------------------------------------------
// @parcely/retry — backoff helpers: sleep, computeDelay, parseRetryAfter
// ---------------------------------------------------------------------------

/**
 * Returns the number of milliseconds to wait given a `Retry-After` header
 * value. Supports both the integer form (`"120"` -> 120 000 ms) and the
 * HTTP-date form (`"Wed, 21 Oct 2026 07:28:00 GMT"` -> delta from now).
 *
 * Returns `undefined` when the header is missing, empty, or unparseable.
 * The result is **not** clamped here — callers must apply `maxDelayMs`.
 *
 * @param value - Raw `Retry-After` header value.
 * @returns Delay in milliseconds, or `undefined`.
 */
export function parseRetryAfter(
  value: string | null | undefined,
): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  // Try integer (seconds) first
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try HTTP-date
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  const delta = dateMs - Date.now();
  // If the date is in the past, treat as "retry immediately"
  return Math.max(0, delta);
}

/**
 * Computes the backoff delay for a given retry attempt using exponential
 * backoff with **full jitter**.
 *
 * Formula: `random() * min(baseDelayMs * 2^attempt, maxDelayMs)`
 *
 * This is the "Full Jitter" strategy from the AWS architecture blog —
 * spreads retries uniformly across [0, cap] to decorrelate concurrent
 * callers and reduce thundering-herd spikes.
 *
 * @param attempt - 1-indexed retry attempt number.
 * @param baseDelayMs - Base delay in ms (default 300).
 * @param maxDelayMs - Upper bound for any single delay (default 30 000).
 * @returns Delay in milliseconds.
 */
export function computeDelay(
  attempt: number,
  baseDelayMs: number = 300,
  maxDelayMs: number = 30_000,
): number {
  const expDelay = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(expDelay, maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Sleeps for the given number of milliseconds. Rejects immediately (or
 * mid-sleep) if the provided `AbortSignal` is already / becomes aborted.
 *
 * @param ms - Duration to sleep.
 * @param signal - Optional `AbortSignal` to cancel the sleep.
 * @returns A promise that resolves after `ms` or rejects on abort.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Already aborted — reject immediately
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      cleanup();
      reject(signal!.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }

    function cleanup(): void {
      signal?.removeEventListener('abort', onAbort);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
