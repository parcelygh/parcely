// ---------------------------------------------------------------------------
// postalservice — public barrel
// ---------------------------------------------------------------------------

// Client factory
export { createClient } from './client.js';

// Errors (value + type re-exports)
export { HttpError, isHttpError } from './errors.js';
export type { HttpErrorCode, HttpErrorOptions } from './errors.js';

// Types (re-exported as type-only)
export type {
  HeadersInit,
  TlsConfig,
  ProgressEvent,
  FormDataSerializer,
  ResponseType,
  StandardSchemaV1,
  Validator,
  RequestConfig,
  HttpResponse,
  InterceptorHandler,
  InterceptorManager,
  Client,
} from './types.js';
