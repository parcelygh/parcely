// ---------------------------------------------------------------------------
// @parcely/react — useSuspenseQuery hook
// ---------------------------------------------------------------------------

import { useState, useContext } from 'react';
import type { Validator, ValidatorOutput, HttpResponse, RequestConfig } from '@parcely/core';
import { ParcelyContext } from './context.js';
import { deriveKey } from './keys.js';
import { fetchOrDedup } from './dedup.js';
import type { UseQueryOptions, UseSuspenseQueryResult } from './types.js';

// ---- Suspense cache -------------------------------------------------------
// Module-level cache so entries survive across render attempts (React
// discards component state when a promise is thrown during render).

interface CacheEntry {
  promise: Promise<HttpResponse<unknown>>;
  result?: HttpResponse<unknown>;
  error?: unknown;
  settled: boolean;
}

const suspenseCache = new Map<string, CacheEntry>();

/** Clear the suspense cache. Exported for testing only. */
export function clearSuspenseCache(): void {
  suspenseCache.clear();
}

// ---- Overloads ------------------------------------------------------------

/**
 * Suspense-compatible query hook. Throws the in-flight promise during loading
 * (caught by `<Suspense>`) and throws `HttpError` on failure (caught by
 * `<ErrorBoundary>`). On success, `data` is guaranteed non-null.
 */
export function useSuspenseQuery<V extends Validator<unknown>>(
  url: string,
  options: UseQueryOptions<V> & { validate: V },
): UseSuspenseQueryResult<ValidatorOutput<V>>;
export function useSuspenseQuery<T = unknown>(
  url: string,
  options?: UseQueryOptions<Validator<unknown>>,
): UseSuspenseQueryResult<T>;
export function useSuspenseQuery(
  url: string,
  options?: UseQueryOptions<Validator<unknown>>,
): UseSuspenseQueryResult<unknown> {
  const ctxClient = useContext(ParcelyContext);
  const client = options?.client ?? ctxClient;

  if (!client) {
    throw new Error(
      'useSuspenseQuery: no client available. Wrap your app in ' +
        '<ParcelyProvider> or pass `client` in options.',
    );
  }

  const params = options?.params;
  const headers = options?.headers;
  const timeout = options?.timeout;
  const validate = options?.validate;

  const key = deriveKey('GET', url, params);

  // Use a toggle to force re-render on refetch
  const [version, setVersion] = useState(0);
  const cacheKey = `${key}:v${String(version)}`;

  let entry = suspenseCache.get(cacheKey);

  if (!entry) {
    // Start a new fetch
    const config: RequestConfig = {};
    if (params !== undefined) config.params = params;
    if (headers !== undefined) config.headers = headers;
    if (timeout !== undefined) config.timeout = timeout;
    if (validate !== undefined) config.validate = validate;

    const promise = fetchOrDedup(cacheKey, () =>
      client.get(url, config),
    );

    entry = {
      promise,
      settled: false,
    };

    promise.then(
      (result) => {
        entry!.result = result;
        entry!.settled = true;
      },
      (error: unknown) => {
        entry!.error = error;
        entry!.settled = true;
      },
    );

    suspenseCache.set(cacheKey, entry);
  }

  if (!entry.settled) {
    // Throw promise — React Suspense catches it
    throw entry.promise;
  }

  if (entry.error !== undefined) {
    // Throw error — ErrorBoundary catches it
    throw entry.error;
  }

  const refetch = () => {
    // Remove the current cache entry and bump version to trigger re-render
    suspenseCache.delete(cacheKey);
    setVersion((v: number) => v + 1);
  };

  return {
    data: entry.result!.data,
    refetch,
  };
}
