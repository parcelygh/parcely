// ---------------------------------------------------------------------------
// @parcely/react — in-flight request deduplication
// ---------------------------------------------------------------------------

import type { HttpResponse } from '@parcely/core';

const inflight = new Map<string, Promise<HttpResponse<unknown>>>();

/**
 * Return an existing in-flight promise for `key`, or call `fn()` and store
 * the promise until it settles. Settle (resolve or reject) removes the entry
 * so the next call triggers a fresh fetch.
 */
export function fetchOrDedup<T>(
  key: string,
  fn: () => Promise<HttpResponse<T>>,
): Promise<HttpResponse<T>> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<HttpResponse<T>>;
  }

  const promise = fn().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise as Promise<HttpResponse<unknown>>);
  return promise;
}

/** Clear all in-flight entries. Exported for testing only. */
export function clearInflight(): void {
  inflight.clear();
}
