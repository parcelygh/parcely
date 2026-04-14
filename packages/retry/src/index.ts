// ---------------------------------------------------------------------------
// @parcely/retry — interceptor-based retry with exponential backoff + jitter
// ---------------------------------------------------------------------------

import type {
  Client,
  InterceptorHandler,
  RequestConfig,
  HttpResponse,
} from '@parcely/core';

import { computeDelay, parseRetryAfter, sleep } from './backoff.js';

// ---- HttpError structural check (no runtime import) ----------------------

/**
 * Structural subset of `HttpError` used by the retry predicate and hooks.
 * No runtime import from `parcely` — recognised via duck-typing.
 */
export interface HttpErrorLike {
  code?: string;
  status?: number;
  config?: RequestConfig;
  response?: HttpResponse<unknown>;
}

function isHttpErrorLike(err: unknown): err is HttpErrorLike {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e['code'] === 'string' && 'config' in e;
}

// ---- Options -------------------------------------------------------------

/**
 * Configuration for the retry interceptor factory.
 *
 * @example
 * ```ts
 * const retry = createRetry({
 *   count: 3,
 *   onRetry: ({ attempt, error, delayMs }) =>
 *     console.log(`Retry #${attempt} in ${delayMs}ms`),
 * });
 * retry.install(http);
 * ```
 */
export interface RetryOptions {
  /**
   * Max retry attempts (NOT including the initial request).
   * Default: 3. So 1 initial + 3 retries = 4 total requests worst case.
   */
  count?: number;

  /**
   * HTTP methods eligible for automatic retry. Defaults to idempotent
   * methods only — POST and PATCH are NOT retried unless explicitly
   * listed here, because replaying a non-idempotent request can cause
   * duplicate side-effects.
   * Default: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
   */
  methods?: string[];

  /**
   * Predicate that decides whether a failure is retryable. Called with the
   * HttpError. Default: retries on
   *   - code === 'ERR_NETWORK'
   *   - code === 'ERR_TIMEOUT'
   *   - code === 'ERR_HTTP_STATUS' AND status in [408, 429, 500, 502, 503, 504]
   * Not retried on: ERR_ABORTED (user cancelled), ERR_VALIDATION, ERR_*
   * (security errors).
   */
  retryOn?: (err: HttpErrorLike) => boolean;

  /**
   * Delay between attempts. May be a number (fixed ms), a function of
   * attempt number + err, or omitted (default: exponential backoff with
   * full jitter — baseMs * 2^attempt, randomised in [0, bound], capped
   * at maxDelayMs).
   */
  delay?: number | ((attempt: number, err: HttpErrorLike) => number);

  /**
   * Base for exponential backoff when `delay` is not a function. Default 300ms.
   */
  baseDelayMs?: number;

  /**
   * Upper bound for any single delay between attempts. Default 30_000 (30s).
   */
  maxDelayMs?: number;

  /**
   * Honor the server's `Retry-After` header on 429 / 503 responses.
   * When the server tells us to wait N seconds (or until a specific date),
   * we prefer that over the computed delay — clamped by maxDelayMs so a
   * buggy server can't DoS us with a 9999999 s header.
   * Default: true.
   */
  retryAfter?: boolean;

  /**
   * Hook called before each retry. Useful for logging, metrics, or
   * cancelling via the controller. If it throws, the retry is aborted
   * and the original error is rethrown.
   */
  onRetry?: (ctx: {
    attempt: number;
    error: HttpErrorLike;
    delayMs: number;
  }) => void | Promise<void>;
}

// ---- Extended config (internal markers) ----------------------------------

/** @internal Markers placed on the retry config. */
interface RetryConfig extends RequestConfig {
  _retryCount?: number;
  _retry?: boolean;
}

// ---- Handle --------------------------------------------------------------

/**
 * The object returned by {@link createRetry}. Exposes the response error
 * interceptor handler for manual wiring, plus an `install()` convenience
 * method.
 */
export interface RetryHandle {
  /** Response interceptor pair — the retry logic lives in `rejected`. */
  response: {
    rejected: InterceptorHandler<HttpResponse<unknown>>['rejected'];
  };

  /**
   * Convenience method: wires the response error interceptor onto the
   * given client instance and captures the client reference for issuing
   * retry requests.
   */
  install(client: Client): void;
}

// ---- Default retryOn predicate -------------------------------------------

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function defaultRetryOn(err: HttpErrorLike): boolean {
  const { code, status } = err;
  if (code === 'ERR_NETWORK' || code === 'ERR_TIMEOUT') {
    return true;
  }
  if (code === 'ERR_HTTP_STATUS' && status !== undefined && RETRYABLE_STATUSES.has(status)) {
    return true;
  }
  return false;
}

// ---- Factory -------------------------------------------------------------

const DEFAULT_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

/**
 * Creates a retry interceptor that:
 *
 * 1. **Response error interceptor** — intercepts retryable errors
 *    (network, timeout, or qualifying HTTP statuses) and replays the
 *    request up to `count` times with exponential backoff + full jitter.
 *
 * 2. **Retry-After support** — honours integer and HTTP-date forms of
 *    the `Retry-After` header on 429 / 503, clamped to `maxDelayMs`.
 *
 * 3. **AbortSignal-aware** — if the request's `config.signal` fires
 *    during the backoff sleep, the retry is cancelled and the abort
 *    propagates.
 *
 * 4. **Coexists with `@parcely/auth-token`** — auth-token marks its
 *    own retry with `_retry: true`. This interceptor tracks retry
 *    attempts via `_retryCount` independently so the two don't
 *    double-count.
 *
 * @param opts - Configuration options.
 * @returns A {@link RetryHandle} with the interceptor and `install()`.
 *
 * @example
 * ```ts
 * import { createRetry } from '@parcely/retry';
 * import { createClient } from '@parcely/core';
 *
 * const http = createClient({ baseURL: 'https://api.example.com' });
 * const retry = createRetry({ count: 3 });
 * retry.install(http);
 * ```
 */
export function createRetry(opts?: RetryOptions): RetryHandle {
  const count = opts?.count ?? 3;
  const methods = (opts?.methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase());
  const retryOn = opts?.retryOn ?? defaultRetryOn;
  const delayOpt = opts?.delay;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  const maxDelayMs = opts?.maxDelayMs ?? 30_000;
  const retryAfter = opts?.retryAfter ?? true;
  const onRetry = opts?.onRetry;

  // -- Client ref for retry --------------------------------------------------

  let clientRef: Client | undefined;

  // -- Response error interceptor --------------------------------------------

  const responseRejected: InterceptorHandler<HttpResponse<unknown>>['rejected'] =
    async (err: unknown): Promise<unknown> => {
      if (!isHttpErrorLike(err)) {
        throw err;
      }

      const config = err.config as RetryConfig | undefined;

      // Check method eligibility (case-insensitive)
      const method = (config?.method ?? 'GET').toUpperCase();
      if (!methods.includes(method)) {
        throw err;
      }

      // Check if the error is retryable
      if (!retryOn(err)) {
        throw err;
      }

      // Determine current retry count (may already be > 0 if the config
      // was marked by a previous pass through this interceptor)
      const startingRetryCount = config?._retryCount ?? 0;

      // Exhausted retries — propagate the error
      if (startingRetryCount >= count) {
        throw err;
      }

      // If install() wasn't called, we can't issue retries
      if (clientRef === undefined) {
        throw err;
      }

      // Internal retry loop — avoids depending on the interceptor chain
      // calling us again for each sub-failure.
      let lastError: HttpErrorLike = err;
      let currentRetryCount = startingRetryCount;

      while (currentRetryCount < count) {
        const attempt = currentRetryCount + 1;
        let delayMs: number;

        if (typeof delayOpt === 'function') {
          delayMs = delayOpt(attempt, lastError);
        } else if (typeof delayOpt === 'number') {
          delayMs = delayOpt;
        } else {
          delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs);
        }

        // Honour Retry-After header when enabled
        if (retryAfter && lastError.response) {
          const retryAfterHeader = lastError.response.headers.get('retry-after');
          if (retryAfterHeader !== null) {
            const retryAfterMs = parseRetryAfter(retryAfterHeader);
            if (retryAfterMs !== undefined) {
              // Prefer the server's value, but clamp to maxDelayMs
              delayMs = Math.min(retryAfterMs, maxDelayMs);
            }
          }
        }

        // Fire onRetry hook — if it throws, abort the retry loop
        if (onRetry) {
          try {
            await onRetry({ attempt, error: lastError, delayMs });
          } catch {
            throw lastError;
          }
        }

        // Sleep with AbortSignal awareness
        const signal = config?.signal;
        await sleep(delayMs, signal);

        // Build retry config
        const retryConfig: RetryConfig = {
          ...config,
          _retryCount: attempt,
        };

        try {
          return await clientRef.request(retryConfig);
        } catch (retryErr: unknown) {
          if (!isHttpErrorLike(retryErr)) {
            throw retryErr;
          }

          // Check if the new error is retryable
          if (!retryOn(retryErr)) {
            throw retryErr;
          }

          lastError = retryErr;
          currentRetryCount = attempt;
        }
      }

      // Exhausted all retries
      throw lastError;
    };

  // -- Handle ----------------------------------------------------------------

  const handle: RetryHandle = {
    response: {
      rejected: responseRejected,
    },
    install(client: Client): void {
      clientRef = client;
      client.interceptors.response.use(undefined, responseRejected);
    },
  };

  return handle;
}
