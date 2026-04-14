// ---------------------------------------------------------------------------
// @parcely/react — shared hook types
// ---------------------------------------------------------------------------

import type {
  Client,
  RequestConfig,
  HttpResponse,
  Validator,
  ValidatorOutput,
} from '@parcely/core';
import { HttpError } from '@parcely/core';

// Re-export HttpError so tests/consumers can import from this package
export { HttpError };

// ---- Query ----------------------------------------------------------------

/**
 * Options accepted by {@link useQuery} and {@link useSuspenseQuery}.
 * Extends a subset of `RequestConfig` and adds hook-specific fields.
 */
export interface UseQueryOptions<V extends Validator<unknown> = Validator<unknown>> {
  /** Validator — when provided, narrows the response data type. */
  validate?: V | undefined;
  /** Explicit client — overrides the context provider. */
  client?: Client | undefined;
  /** When `false`, the query is disabled and no fetch fires. Default: `true`. */
  enabled?: boolean | undefined;
  /** Query string parameters merged into the request. */
  params?: Record<string, unknown> | undefined;
  /** Per-request headers. */
  headers?: RequestConfig['headers'] | undefined;
  /** Abort timeout in milliseconds. */
  timeout?: number | undefined;
}

/**
 * Return value of {@link useQuery}.
 */
export interface UseQueryResult<T> {
  data: T | undefined;
  error: HttpError | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Return value of {@link useSuspenseQuery}. `data` is guaranteed non-null
 * because loading state is handled by `<Suspense>` and errors by
 * `<ErrorBoundary>`.
 */
export interface UseSuspenseQueryResult<T> {
  data: T;
  refetch: () => void;
}

// ---- Mutation -------------------------------------------------------------

/**
 * Options accepted by {@link useMutation}.
 */
export interface UseMutationOptions<V extends Validator<unknown> = Validator<unknown>> {
  /** Validator — when provided, narrows the response data type. */
  validate?: V | undefined;
  /** Explicit client — overrides the context provider. */
  client?: Client | undefined;
  /** Per-request headers. */
  headers?: RequestConfig['headers'] | undefined;
  /** Query string parameters merged into the request. */
  params?: Record<string, unknown> | undefined;
  /** Abort timeout in milliseconds. */
  timeout?: number | undefined;
}

/**
 * Return value of {@link useMutation}.
 */
export interface UseMutationResult<T> {
  mutate: (body?: unknown) => void;
  mutateAsync: (body?: unknown) => Promise<HttpResponse<T>>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: HttpError | undefined;
  data: T | undefined;
  reset: () => void;
}

// ---- Utility re-exports for consumers ------------------------------------

export type { Client, RequestConfig, HttpResponse, Validator, ValidatorOutput };
