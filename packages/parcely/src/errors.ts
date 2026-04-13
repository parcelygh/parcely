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
      captureStackTrace?: (target: object, ctor: Function) => void;
    };
    if (typeof ErrorWithCapture.captureStackTrace === 'function') {
      ErrorWithCapture.captureStackTrace(this, HttpError);
    }
  }
}

// ---- Type guard -----------------------------------------------------------

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
