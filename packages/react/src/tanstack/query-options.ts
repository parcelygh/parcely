// ---------------------------------------------------------------------------
// @parcely/react/tanstack — queryOptions adapter
// ---------------------------------------------------------------------------

import type { QueryKey } from '@tanstack/react-query';
import type { Client, RequestConfig, Validator, ValidatorOutput } from '@parcely/core';
import { deriveKey } from '../keys.js';

/**
 * Build a `{ queryKey, queryFn }` object compatible with TanStack Query's
 * `useQuery`. The `queryFn` forwards TQ's `{ signal }` context to parcely.
 */
export function queryOptions<V extends Validator<unknown>>(
  client: Client,
  url: string,
  options: RequestConfig & { validate: V },
): { queryKey: QueryKey; queryFn: (ctx: { signal: AbortSignal }) => Promise<ValidatorOutput<V>> };

export function queryOptions<T = unknown>(
  client: Client,
  url: string,
  options?: RequestConfig,
): { queryKey: QueryKey; queryFn: (ctx: { signal: AbortSignal }) => Promise<T> };

export function queryOptions(
  client: Client,
  url: string,
  options?: RequestConfig,
): { queryKey: QueryKey; queryFn: (ctx: { signal: AbortSignal }) => Promise<unknown> } {
  const keyStr = deriveKey('GET', url, options?.params);
  const queryKey: QueryKey = JSON.parse(keyStr) as QueryKey;

  return {
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      client.get(url, { ...options, signal }).then((r) => r.data),
  };
}
