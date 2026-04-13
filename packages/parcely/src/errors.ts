// ---------------------------------------------------------------------------
// parcely — HttpError and isHttpError
// ---------------------------------------------------------------------------

import type { HttpResponse, RequestConfig } from './types.js';

// ---- Error codes ----------------------------------------------------------

export type HttpErrorCode =
  | 'ERR_HTTP_STATUS'
  | 'ERR_NETWORK'
  | 'ERR_TIMEOUT'
  | 'ERR_ABORTED'
  | 'ERR_TOO_MANY_REDIRECTS'
  | 'ERR_DISALLOWED_PROTOCOL'
  | 'ERR_DISALLOWED_HEADER'
  | 'ERR_ABSOLUTE_URL'
  | 'ERR_PARSE'
  | 'ERR_VALIDATION'
  | 'ERR_CRLF_INJECTION';

// ---- HttpError class ------------------------------------------------------

export interface HttpErrorOptions {
  code: HttpErrorCode;
  status?: number;
  config: RequestConfig;
  response?: HttpResponse<unknown>;
  cause?: unknown;
}

/**
 * Plain-object form of HttpError, safe for JSON serialization.
 *
 * The live {@link HttpError} contains non-serializable values (`Headers`
 * instances inside `config` and `response`, arbitrary `cause` objects).
 * Calling `JSON.stringify(error)` would silently produce `"{}"` for
 * `Headers` and throw on circular `cause` references. `toJSON()` returns
 * this normalised shape so log aggregators and error reporters get
 * something readable.
 */
export interface HttpErrorJSON {
  name: 'HttpError';
  message: string;
  code: HttpErrorCode;
  status?: number;
  config: {
    method?: string;
    url?: string;
    baseURL?: string;
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    timeout?: number;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
  };
  cause?: { name?: string; message?: string; code?: string };
  stack?: string;
}

export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly status: number | undefined;
  readonly config: RequestConfig;
  readonly response: HttpResponse<unknown> | undefined;
  override readonly cause: unknown;

  constructor(message: string, opts: HttpErrorOptions) {
    super(message);
    this.name = 'HttpError';
    this.code = opts.code;
    this.status = opts.status;
    this.config = opts.config;
    this.response = opts.response;
    this.cause = opts.cause;

    // Capture stack trace when running in V8 environments (Node, Chrome)
    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: object, ctor: (...args: unknown[]) => unknown) => void;
    };
    if (typeof ErrorWithCapture.captureStackTrace === 'function') {
      ErrorWithCapture.captureStackTrace(
        this,
        HttpError as unknown as (...args: unknown[]) => unknown,
      );
    }
  }

  /**
   * Produce a JSON-safe representation of the error.
   *
   * - `Headers` instances are flattened to plain `Record<string, string>`
   *   (this picks up the already-redacted header values from the envelope).
   * - `response.data` is included as-is; callers relying on `JSON.stringify`
   *   are responsible for ensuring it's serializable.
   * - `cause` is reduced to `{ name, message, code }` — arbitrary objects
   *   with circular refs would otherwise throw at stringify time.
   * - `stack` is included for local debugging; strip it before sending
   *   errors to untrusted endpoints.
   *
   * This method is invoked automatically by `JSON.stringify(error)`.
   */
  toJSON(): HttpErrorJSON {
    const json: HttpErrorJSON = {
      name: 'HttpError',
      message: this.message,
      code: this.code,
      config: normaliseConfig(this.config),
    };
    if (this.status !== undefined) json.status = this.status;
    if (this.response) {
      json.response = {
        status: this.response.status,
        statusText: this.response.statusText,
        headers: headersToRecord(this.response.headers),
        data: this.response.data,
      };
    }
    if (this.cause !== undefined) {
      json.cause = normaliseCause(this.cause);
    }
    if (this.stack) json.stack = this.stack;
    return json;
  }
}

// ---- Serialization helpers ------------------------------------------------

function headersToRecord(
  headers: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers as [string, string][]) out[k] = v;
    return out;
  }
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

function normaliseConfig(config: RequestConfig): HttpErrorJSON['config'] {
  const out: HttpErrorJSON['config'] = {};
  if (config.method !== undefined) out.method = config.method;
  if (config.url !== undefined) out.url = config.url;
  if (config.baseURL !== undefined) out.baseURL = String(config.baseURL);
  if (config.headers !== undefined) out.headers = headersToRecord(config.headers);
  if (config.params !== undefined) out.params = config.params;
  if (config.timeout !== undefined) out.timeout = config.timeout;
  return out;
}

function normaliseCause(cause: unknown): NonNullable<HttpErrorJSON['cause']> {
  // Callers guard with `cause !== undefined`, so we never return undefined.
  if (cause === null) return { message: 'null' };
  if (typeof cause !== 'object') {
    return { message: String(cause) };
  }
  const c = cause as { name?: unknown; message?: unknown; code?: unknown };
  const out: NonNullable<HttpErrorJSON['cause']> = {};
  if (typeof c.name === 'string') out.name = c.name;
  if (typeof c.message === 'string') out.message = c.message;
  if (typeof c.code === 'string') out.code = c.code;
  return out;
}

// ---- Type guard -----------------------------------------------------------

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
