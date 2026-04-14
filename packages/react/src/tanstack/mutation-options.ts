// ---------------------------------------------------------------------------
// @parcely/react/tanstack — mutationOptions adapter
// ---------------------------------------------------------------------------

import type { QueryKey } from '@tanstack/react-query';
import type { Client, RequestConfig, Validator, ValidatorOutput } from '@parcely/core';

/**
 * Build a `{ mutationKey, mutationFn }` object compatible with TanStack
 * Query's `useMutation`.
 */
export function mutationOptions<V extends Validator<unknown>>(
  client: Client,
  method: string,
  url: string,
  options: RequestConfig & { validate: V },
): { mutationKey: QueryKey; mutationFn: (body?: unknown) => Promise<ValidatorOutput<V>> };

export function mutationOptions<T = unknown>(
  client: Client,
  method: string,
  url: string,
  options?: RequestConfig,
): { mutationKey: QueryKey; mutationFn: (body?: unknown) => Promise<T> };

export function mutationOptions(
  client: Client,
  method: string,
  url: string,
  options?: RequestConfig,
): { mutationKey: QueryKey; mutationFn: (body?: unknown) => Promise<unknown> } {
  const mutationKey: QueryKey = ['parcely', method.toUpperCase(), url];

  return {
    mutationKey,
    mutationFn: (body?: unknown) =>
      client.request({ method, url, body, ...options }).then((r) => r.data),
  };
}
