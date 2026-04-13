// ---------------------------------------------------------------------------
// parcely — shared public types
// ---------------------------------------------------------------------------

// ---- Header helpers -------------------------------------------------------

/** Accepted shapes for request headers. */
export type HeadersInit = Record<string, string> | [string, string][] | Headers;

// ---- TLS (Node-only) -----------------------------------------------------

export interface TlsConfig {
  rejectUnauthorized?: boolean;
  ca?: string | string[];
}

// ---- Progress -------------------------------------------------------------

export interface ProgressEvent {
  loaded: number;
  total?: number;
  percent?: number;
}

// ---- FormData serialisation -----------------------------------------------

export type FormDataSerializer = 'brackets' | 'indices' | 'repeat';

// ---- Response type --------------------------------------------------------

/**
 * Determines how the response body is delivered as `data`.
 *
 * - `'json'` (default) — content-type-sniffed; falls back to text on non-JSON
 * - `'text'` — UTF-8 decoded string
 * - `'arraybuffer'` — raw bytes as `ArrayBuffer`
 * - `'blob'` — `Blob` instance (re-streamable, typed by content-type)
 * - `'stream'` — the raw `ReadableStream<Uint8Array> | null`, un-consumed.
 *   Skips JSON parsing and skips `validate` (cannot validate without reading).
 */
export type ResponseType = 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';

// ---- Validator extension point --------------------------------------------

/**
 * Minimal structural type matching Standard Schema v1.
 * @see https://standardschema.dev
 *
 * This is a type-only declaration — no runtime import required.  Any
 * validator whose shape is assignable to this interface (Zod 3.24+,
 * Valibot 1+, ArkType 2+, Effect-Schema, etc.) works out of the box.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export namespace StandardSchemaV1 {
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }
}

/**
 * A validator accepted by `RequestConfig.validate`.
 *
 * Three shapes are supported (checked in this order at runtime):
 * 1. Standard Schema v1  — detected via the `~standard` property
 * 2. `.parse()` object   — e.g. Zod < 3.24 / manual adapters
 * 3. Plain function       — `(input: unknown) => T`
 */
export type Validator<T> =
  | ((input: unknown) => T)
  | { parse(input: unknown): T }
  | StandardSchemaV1<unknown, T>;

/**
 * Extracts the output type produced by any {@link Validator}. Used by the
 * `Client` method overloads so that `http.get('/u', { validate: zodSchema })`
 * narrows `data` to the validator's parsed type without explicit `<T>`.
 *
 * Standard Schema is checked **first** because Zod 3.24+ schemas implement
 * both `~standard` and `parse()` — picking the structural branch ensures we
 * read the canonical output type from `types.output` rather than the
 * unparameterized `parse()` return.
 */
export type ValidatorOutput<V> =
  V extends StandardSchemaV1<unknown, infer Out> ? Out :
  V extends { parse(input: unknown): infer Out } ? Out :
  V extends (input: unknown) => infer Out ? Out :
  unknown;

// ---- Request config -------------------------------------------------------

export interface RequestConfig {
  baseURL?: string | URL;
  url?: string;
  method?: string;
  headers?: HeadersInit;
  params?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  responseType?: ResponseType;
  validate?: Validator<unknown>;
  tls?: TlsConfig;

  // Redirect behaviour
  followRedirects?: boolean;
  maxRedirects?: number;
  /** Low-level fetch `redirect` option — internal use. `followRedirects` takes priority. */
  redirect?: 'follow' | 'manual' | 'error';

  // Security
  allowAbsoluteUrls?: boolean;
  allowedProtocols?: string[];
  allowedRequestHeaders?: string[];
  sensitiveHeaders?: string[];

  // Body / upload
  formDataSerializer?: FormDataSerializer;
  onUploadProgress?: (event: ProgressEvent) => void;
  onDownloadProgress?: (event: ProgressEvent) => void;
}

// ---- Response envelope ----------------------------------------------------

export interface HttpResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  /** Merged + post-interceptor config with sensitive headers redacted. */
  config: RequestConfig;
}

// ---- Interceptors ---------------------------------------------------------

export interface InterceptorHandler<T> {
  fulfilled?: (value: T) => T | Promise<T>;
  rejected?: (err: unknown) => unknown;
}

export interface InterceptorManager<T> {
  use(handler: InterceptorHandler<T>): number;
  use(
    onFulfilled?: (value: T) => T | Promise<T>,
    onRejected?: (err: unknown) => unknown,
  ): number;
  eject(id: number): void;
}

// ---- Client interface -----------------------------------------------------

/**
 * Parcely client.
 *
 * Each request method has two overloads:
 *
 * 1. **Validating overload** — when `config.validate` is provided, the
 *    response `data` type is **inferred from the validator's output**. No
 *    explicit `<T>` needed.
 *
 *    ```ts
 *    const { data } = await http.get('/u', { validate: UserSchema })
 *    //          ^? z.infer<typeof UserSchema>
 *    ```
 *
 * 2. **Generic overload** — without `validate`, the caller annotates `<T>`.
 *    ```ts
 *    const { data } = await http.get<User>('/u')
 *    //          ^? User
 *    ```
 *
 * The validating overload is listed first so TS prefers it when both apply.
 */
export interface Client {
  defaults: RequestConfig;

  interceptors: {
    request: InterceptorManager<RequestConfig>;
    response: InterceptorManager<HttpResponse<unknown>>;
  };

  request<V extends Validator<unknown>>(
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  request<T>(config: RequestConfig): Promise<HttpResponse<T>>;

  get<V extends Validator<unknown>>(
    url: string,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  get<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;

  delete<V extends Validator<unknown>>(
    url: string,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  delete<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;

  head<V extends Validator<unknown>>(
    url: string,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  head<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;

  options<V extends Validator<unknown>>(
    url: string,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  options<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;

  post<V extends Validator<unknown>, B = unknown>(
    url: string,
    body: B | undefined,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  post<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;

  put<V extends Validator<unknown>, B = unknown>(
    url: string,
    body: B | undefined,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  put<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;

  patch<V extends Validator<unknown>, B = unknown>(
    url: string,
    body: B | undefined,
    config: RequestConfig & { validate: V },
  ): Promise<HttpResponse<ValidatorOutput<V>>>;
  patch<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;
}
