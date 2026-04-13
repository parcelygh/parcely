// ---------------------------------------------------------------------------
// @parcely/auth-redirect — browser redirect interceptor for auth errors
// ---------------------------------------------------------------------------

import type {
  Client,
  HttpResponse,
  InterceptorHandler,
} from 'parcely';
import { HttpError } from 'parcely';

// ---- Public option types ---------------------------------------------------

/**
 * Configuration options for {@link createAuthRedirect}.
 *
 * @example
 * ```ts
 * const redirect = createAuthRedirect({
 *   loginUrl: '/login',
 *   on: [401, 403],
 *   preserveReturnTo: true,
 * })
 * redirect.install(http)
 * ```
 */
export interface AuthRedirectOptions {
  /**
   * The URL to redirect to on auth errors. When a function, it receives the
   * triggering {@link HttpError} and must return the login URL string.
   */
  loginUrl: string | ((err: HttpError) => string);

  /**
   * HTTP status codes that trigger a redirect.
   * @defaultValue `[401, 403]`
   */
  on?: number[];

  /**
   * When `true`, appends a query parameter with the current page URL so
   * the login page can redirect back after authentication.
   * @defaultValue `true`
   */
  preserveReturnTo?: boolean;

  /**
   * The query parameter name used when {@link preserveReturnTo} is enabled.
   * @defaultValue `'return_to'`
   */
  returnToParam?: string;

  /**
   * Optional predicate. When provided, the redirect is suppressed if this
   * function returns `false` for a given error.
   */
  shouldRedirect?: (err: HttpError) => boolean;

  /**
   * Minimum milliseconds between consecutive redirects. Prevents redirect
   * storms when many requests fail simultaneously.
   * @defaultValue `2000`
   */
  cooldownMs?: number;
}

// ---- Handle (return type) --------------------------------------------------

/**
 * Handle returned by {@link createAuthRedirect}. Provides the response error
 * interceptor and a convenience `install` method.
 */
export interface AuthRedirectHandle {
  /** Response interceptor handlers (only `rejected` is used). */
  response: {
    rejected: InterceptorHandler<HttpResponse<unknown>>['rejected'];
  };

  /**
   * Attaches the response error interceptor to the given client.
   * @param client - A parcely {@link Client} instance.
   */
  install(client: Client): void;
}

// ---- Factory ---------------------------------------------------------------

/**
 * Creates a browser-redirect interceptor that navigates to a login URL when
 * the server responds with an auth-related HTTP status code.
 *
 * In non-browser runtimes (no `window` global) the interceptor is a silent
 * no-op — it emits a single `console.warn` on the first invocation, then
 * passes errors through without side effects.
 *
 * The original error is **always** rethrown so downstream error handlers can
 * still observe it.
 *
 * @param opts - {@link AuthRedirectOptions}
 * @returns An {@link AuthRedirectHandle} with `.install(client)`.
 *
 * @example
 * ```ts
 * import { createClient } from 'parcely'
 * import { createAuthRedirect } from '\@parcely/auth-redirect'
 *
 * const http = createClient({ baseURL: 'https://api.example.com' })
 * const redirect = createAuthRedirect({ loginUrl: '/login' })
 * redirect.install(http)
 * ```
 */
export function createAuthRedirect(opts: AuthRedirectOptions): AuthRedirectHandle {
  const statusCodes = opts.on ?? [401, 403];
  const preserveReturnTo = opts.preserveReturnTo ?? true;
  const returnToParam = opts.returnToParam ?? 'return_to';
  const cooldownMs = opts.cooldownMs ?? 2000;

  let lastRedirectTime = 0;
  let nonBrowserWarned = false;

  /**
   * Response error interceptor.  Checks whether the error qualifies for a
   * browser redirect and, if so, sets `window.location.href`.
   */
  const rejected: InterceptorHandler<HttpResponse<unknown>>['rejected'] = (
    err: unknown,
  ): never => {
    // Only act on HttpError with an HTTP-status error code
    if (
      err instanceof HttpError &&
      err.code === 'ERR_HTTP_STATUS' &&
      err.status !== undefined &&
      statusCodes.includes(err.status)
    ) {
      // Optional predicate check
      if (opts.shouldRedirect === undefined || opts.shouldRedirect(err)) {
        // Browser guard
        if (typeof window !== 'undefined') {
          const now = Date.now();
          if (now - lastRedirectTime >= cooldownMs) {
            lastRedirectTime = now;

            // Build login URL
            let url =
              typeof opts.loginUrl === 'function'
                ? opts.loginUrl(err)
                : opts.loginUrl;

            if (preserveReturnTo) {
              const separator = url.includes('?') ? '&' : '?';
              url = `${url}${separator}${returnToParam}=${encodeURIComponent(window.location.href)}`;
            }

            window.location.href = url;
          }
        } else {
          // Non-browser runtime — one-shot warning
          if (!nonBrowserWarned) {
            nonBrowserWarned = true;
            console.warn(
              '[@parcely/auth-redirect] ignored in non-browser runtime',
            );
          }
        }
      }
    }

    // Always rethrow
    throw err;
  };

  const handle: AuthRedirectHandle = {
    response: { rejected },

    install(client: Client): void {
      client.interceptors.response.use(undefined, rejected);
    },
  };

  return handle;
}
