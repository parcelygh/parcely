// ---------------------------------------------------------------------------
// @parcely/auth-token — attach tokens to requests; refresh on 401
// ---------------------------------------------------------------------------

import type {
  Client,
  InterceptorHandler,
  RequestConfig,
  HttpResponse,
} from '@parcely/core';

import { createSingleFlight } from './single-flight.js';

// ---- Options --------------------------------------------------------------

/**
 * Configuration for the auth-token interceptor factory.
 *
 * At minimum, `getToken` must be provided. When `refresh` is also supplied,
 * the response interceptor will attempt a single-flight token refresh on
 * qualifying error status codes and retry the original request once.
 *
 * @example
 * ```ts
 * const auth = createAuthToken({
 *   getToken: () => localStorage.getItem('access_token'),
 *   refresh: async () => {
 *     const r = await refreshClient.post('/auth/refresh');
 *     localStorage.setItem('access_token', r.data.access);
 *     return r.data.access;
 *   },
 * });
 * auth.install(http);
 * ```
 */
export interface AuthTokenOptions {
  /**
   * The authentication scheme prepended to the token value.
   * Set to an empty string to send only the raw token.
   * @default 'Bearer'
   */
  scheme?: string;

  /**
   * The HTTP header used to transmit the token.
   * @default 'Authorization'
   */
  header?: string;

  /**
   * Returns the current token. When the return value is `null`, the header
   * is not set (allowing unauthenticated requests to pass through).
   * May be synchronous or asynchronous.
   */
  getToken: () => string | null | Promise<string | null>;

  /**
   * HTTP status codes that should trigger a token refresh.
   * Only relevant when `refresh` is provided.
   * @default [401]
   */
  refreshOn?: number[];

  /**
   * Async function that performs the token refresh and returns the new token.
   * When omitted, errors matching `refreshOn` statuses propagate as-is.
   *
   * Concurrent calls are coalesced into a single in-flight refresh via a
   * single-flight wrapper — only one network call happens regardless of how
   * many requests fail simultaneously.
   */
  refresh?: () => Promise<string>;
}

// ---- Handle ---------------------------------------------------------------

/**
 * The object returned by {@link createAuthToken}. Exposes the individual
 * interceptor handlers for manual wiring, plus an `install()` convenience
 * method.
 */
export interface AuthTokenHandle {
  /** Request interceptor — attaches the token header. */
  request: NonNullable<InterceptorHandler<RequestConfig>['fulfilled']>;

  /** Response interceptor pair — handles refresh-on-error. */
  response: {
    fulfilled?: InterceptorHandler<HttpResponse<unknown>>['fulfilled'];
    rejected?: InterceptorHandler<HttpResponse<unknown>>['rejected'];
  };

  /**
   * Convenience method: wires both the request and response interceptors
   * onto the given client instance.
   */
  install(client: Client): void;
}

// ---- Extended config (internal) -------------------------------------------

/** @internal Marker to prevent infinite retry loops. */
interface RetryableConfig extends RequestConfig {
  _retry?: boolean;
}

// ---- HttpError shape (structural check — no runtime import) ---------------

interface HttpErrorLike {
  code?: string;
  status?: number;
  config?: RequestConfig;
}

function isHttpErrorLike(err: unknown): err is HttpErrorLike {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e['code'] === 'string' && 'config' in e;
}

// ---- Factory --------------------------------------------------------------

/**
 * Creates an auth-token interceptor pair that:
 *
 * 1. **Request interceptor** — reads the current token via `getToken()` and
 *    sets it as `config.headers[header] = '${scheme} ${token}'`. If the
 *    caller has already set the header explicitly, it is **not** overwritten.
 *
 * 2. **Response error interceptor** (only when `refresh` is provided) —
 *    intercepts errors whose HTTP status is in `refreshOn` (default `[401]`),
 *    calls `refresh()` through a single-flight wrapper (concurrent 401s
 *    share one refresh), then retries the original request **once** with the
 *    new token. A `_retry` flag on the config prevents infinite loops: if
 *    the retried request also fails, the error propagates. If `refresh()`
 *    itself rejects, the **original** error propagates.
 *
 * @param opts - Configuration options.
 * @returns An {@link AuthTokenHandle} with interceptor functions and `install()`.
 *
 * @example
 * ```ts
 * import { createAuthToken } from '@parcely/auth-token';
 * import { createClient } from '@parcely/core';
 *
 * const http = createClient({ baseURL: 'https://api.example.com' });
 * const auth = createAuthToken({
 *   getToken: () => localStorage.getItem('access_token'),
 *   refresh: async () => {
 *     const res = await fetch('/auth/refresh', { method: 'POST' });
 *     const data = await res.json();
 *     localStorage.setItem('access_token', data.access);
 *     return data.access;
 *   },
 * });
 *
 * auth.install(http);
 * // — or manually:
 * // http.interceptors.request.use(auth.request);
 * // http.interceptors.response.use(auth.response.fulfilled, auth.response.rejected);
 * ```
 */
export function createAuthToken(opts: AuthTokenOptions): AuthTokenHandle {
  const scheme = opts.scheme ?? 'Bearer';
  const header = opts.header ?? 'Authorization';
  const refreshOn = opts.refreshOn ?? [401];

  // Wrap refresh in single-flight if provided
  const singleFlightRefresh = opts.refresh
    ? createSingleFlight(opts.refresh)
    : undefined;

  // -- Request interceptor ---------------------------------------------------

  const requestInterceptor: NonNullable<
    InterceptorHandler<RequestConfig>['fulfilled']
  > = async (config: RequestConfig): Promise<RequestConfig> => {
    // If this is a retry from our own response interceptor, the new token is
    // already on `config.headers` — re-running `getToken()` here could read a
    // stale value from the user's token store (race against the just-completed
    // refresh) and clobber the fresh header. Pass through untouched.
    if ((config as RetryableConfig)._retry) {
      return config;
    }

    // If the caller explicitly set the header, respect it
    if (hasHeader(config.headers, header)) {
      return config;
    }

    const token = await opts.getToken();
    if (token === null) {
      return config;
    }

    const value = scheme ? `${scheme} ${token}` : token;

    return {
      ...config,
      headers: mergeHeaderValue(config.headers, header, value),
    };
  };

  // -- Response error interceptor --------------------------------------------

  const responseRejected:
    | InterceptorHandler<HttpResponse<unknown>>['rejected']
    | undefined = singleFlightRefresh
    ? async (err: unknown): Promise<unknown> => {
        if (!isHttpErrorLike(err)) {
          throw err;
        }

        const { code, status, config } = err;

        // Only intercept ERR_HTTP_STATUS with a matching status code
        if (
          code !== 'ERR_HTTP_STATUS' ||
          status === undefined ||
          !refreshOn.includes(status)
        ) {
          throw err;
        }

        // Prevent infinite retry loops
        const retryConfig = config as RetryableConfig | undefined;
        if (retryConfig?._retry) {
          throw err;
        }

        // Attempt refresh
        let newToken: string;
        try {
          newToken = await singleFlightRefresh();
        } catch {
          // Refresh failed — propagate the original error
          throw err;
        }

        // Retry the original request once with the new token
        const value = scheme ? `${scheme} ${newToken}` : newToken;
        const retryRequestConfig: RetryableConfig = {
          ...config,
          _retry: true,
          headers: mergeHeaderValue(config?.headers, header, value),
        };

        // We need the client to make the retry request.
        // The install() method captures the client reference for this purpose.
        if (clientRef === undefined) {
          throw err;
        }

        return clientRef.request(retryRequestConfig);
      }
    : undefined;

  // -- Client ref for retry --------------------------------------------------

  let clientRef: Client | undefined;

  // -- install() convenience -------------------------------------------------

  const response: AuthTokenHandle['response'] = {};
  if (responseRejected) {
    response.rejected = responseRejected;
  }

  const handle: AuthTokenHandle = {
    request: requestInterceptor,
    response,
    install(client: Client): void {
      clientRef = client;
      client.interceptors.request.use({ fulfilled: requestInterceptor });
      client.interceptors.response.use(undefined, responseRejected);
    },
  };

  return handle;
}

// ---- Header helpers (internal) --------------------------------------------

function hasHeader(
  headers: RequestConfig['headers'],
  name: string,
): boolean {
  if (headers === undefined || headers === null) return false;

  if (headers instanceof Headers) {
    return headers.has(name);
  }

  if (Array.isArray(headers)) {
    const lowerName = name.toLowerCase();
    return headers.some(([k]) => k.toLowerCase() === lowerName);
  }

  // Record<string, string>
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lowerName);
}

function mergeHeaderValue(
  existing: RequestConfig['headers'],
  name: string,
  value: string,
): Record<string, string> {
  // Normalise existing headers to a plain record
  let record: Record<string, string> = {};

  if (existing instanceof Headers) {
    existing.forEach((v, k) => {
      record[k] = v;
    });
  } else if (Array.isArray(existing)) {
    for (const [k, v] of existing) {
      record[k] = v;
    }
  } else if (existing !== undefined && existing !== null) {
    record = { ...existing };
  }

  record[name] = value;
  return record;
}
