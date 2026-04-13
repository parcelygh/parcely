// ---------------------------------------------------------------------------
// postalservice — core request orchestrator (11-step lifecycle)
// ---------------------------------------------------------------------------

import type { RequestConfig, HttpResponse } from './types.js';
import { HttpError } from './errors.js';
import type { InterceptorChain } from './interceptors.js';
import { mergeConfig } from './config.js';
import { buildUrl } from './url.js';
import { mergeHeaders, enforceAllowedHeaders } from './headers.js';
import { prepareBody } from './body.js';
import { wrapReadableStream } from './progress.js';
import { resolveDispatcher } from './tls.js';
import { redactConfig } from './redact.js';
import { runValidator } from './validate.js';

/** Default list of sensitive headers to strip on cross-origin redirects. */
const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
];

export interface SendContext {
  defaults: RequestConfig;
  requestInterceptors: InterceptorChain<RequestConfig>;
  responseInterceptors: InterceptorChain<HttpResponse<unknown>>;
}

/**
 * Core `send(config)` implementing the 11-step request lifecycle.
 */
export async function send<T = unknown>(
  perCallConfig: RequestConfig,
  context: SendContext,
): Promise<HttpResponse<T>> {
  // Step 1: mergeConfig
  let config = mergeConfig(context.defaults, perCallConfig);

  // Step 2: request interceptor chain
  config = await context.requestInterceptors.run(config);

  // Step 3: validate config — buildUrl + mergeHeaders
  const url = buildUrl(config);
  const headers = mergeHeaders(config.headers);
  enforceAllowedHeaders(headers, config.allowedRequestHeaders, config);

  // Step 4: prepare fetch args
  const { body: rawBody, headers: bodyHeaders } = prepareBody(config.body, config);

  // Apply body-derived headers
  if (bodyHeaders) {
    for (const [key, value] of Object.entries(bodyHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
  }

  // Wrap body for upload progress if requested
  let body = rawBody;
  const fetchInit: RequestInit & { duplex?: string; dispatcher?: unknown } = {};

  if (config.onUploadProgress && body) {
    // Convert body to ReadableStream if possible for progress wrapping
    let stream: ReadableStream<Uint8Array> | undefined;
    let totalBytes: number | undefined;

    if (body instanceof ReadableStream) {
      stream = body as ReadableStream<Uint8Array>;
    } else if (typeof body === 'string') {
      totalBytes = new TextEncoder().encode(body).byteLength;
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body as string));
          controller.close();
        },
      });
    } else if (body instanceof Uint8Array) {
      totalBytes = body.byteLength;
      const bytes = body;
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    } else if (body instanceof ArrayBuffer) {
      totalBytes = body.byteLength;
      const bytes = new Uint8Array(body);
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }

    if (stream) {
      body = wrapReadableStream(stream, totalBytes, config.onUploadProgress);
      fetchInit.duplex = 'half';
    }
  }

  fetchInit.method = (config.method ?? 'GET').toUpperCase();
  fetchInit.headers = headers;
  if (body !== undefined) {
    fetchInit.body = body as BodyInit;
  }

  // Combine signals
  const signals: AbortSignal[] = [];
  if (config.signal) signals.push(config.signal);
  if (config.timeout !== undefined && config.timeout > 0) {
    signals.push(AbortSignal.timeout(config.timeout));
  }
  if (signals.length > 0) {
    fetchInit.signal =
      signals.length === 1
        ? signals[0]!
        : AbortSignal.any(signals);
  }

  // Resolve TLS dispatcher
  const dispatcher = await resolveDispatcher(config.tls);
  if (dispatcher) {
    fetchInit.dispatcher = dispatcher;
  }

  // redirect: 'manual' for our redirect loop
  fetchInit.redirect = 'manual';

  // Step 5: manual redirect loop
  const maxRedirects = config.maxRedirects ?? 5;
  const followRedirects = config.followRedirects ?? true;
  const sensitiveHeaders = config.sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS;
  const sensitiveSet = new Set(sensitiveHeaders.map((h) => h.toLowerCase()));

  let response: Response;
  let currentUrl = url.href;
  let redirectCount = 0;

  try {
    response = await fetch(currentUrl, fetchInit as RequestInit);

    while (followRedirects && isRedirect(response.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new HttpError(
          `Too many redirects (max: ${maxRedirects})`,
          {
            code: 'ERR_TOO_MANY_REDIRECTS',
            config: redactConfig(config, config.sensitiveHeaders),
            status: response.status,
          },
        );
      }

      const location = response.headers.get('location');
      if (!location) break;

      const redirectUrl = new URL(location, currentUrl);

      // Cross-origin check: strip sensitive headers on cross-origin hops
      const originalOrigin = new URL(currentUrl).origin;
      const redirectOrigin = redirectUrl.origin;
      if (originalOrigin !== redirectOrigin) {
        const currentHeaders = fetchInit.headers as Headers;
        for (const header of sensitiveSet) {
          currentHeaders.delete(header);
        }
      }

      currentUrl = redirectUrl.href;

      // Consume old body to free resources
      await response.body?.cancel().catch(() => {});

      // Don't send body on GET/HEAD redirect methods (follow standard browser semantics)
      const redirectInit = { ...fetchInit } as RequestInit & { duplex?: string; dispatcher?: unknown };
      if (response.status === 303 || (response.status !== 307 && response.status !== 308)) {
        redirectInit.method = 'GET';
        delete redirectInit.body;
        delete redirectInit.duplex;
      }

      response = await fetch(currentUrl, redirectInit as RequestInit);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;

    // Inspect abort/timeout signals
    const errAny = err as { name?: string };
    if (errAny.name === 'AbortError' || errAny.name === 'TimeoutError') {
      // Determine if it was user abort or timeout
      if (config.signal?.aborted) {
        throw new HttpError('Request aborted', {
          code: 'ERR_ABORTED',
          config: redactConfig(config, config.sensitiveHeaders),
          cause: err,
        });
      }
      throw new HttpError('Request timed out', {
        code: 'ERR_TIMEOUT',
        config: redactConfig(config, config.sensitiveHeaders),
        cause: err,
      });
    }

    throw new HttpError('Network error', {
      code: 'ERR_NETWORK',
      config: redactConfig(config, config.sensitiveHeaders),
      cause: err,
    });
  }

  // Step 6: parse body per responseType
  let data: unknown;
  try {
    let bodyStream: ReadableStream<Uint8Array> | null = response.body as ReadableStream<Uint8Array> | null;

    // Wrap for download progress
    if (config.onDownloadProgress && bodyStream) {
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
      bodyStream = wrapReadableStream(bodyStream, totalBytes, config.onDownloadProgress);
    }

    const responseType = config.responseType ?? 'json';

    if (responseType === 'json') {
      // Content-type sniff: only parse as JSON if content-type is JSON-ish
      const ct = response.headers.get('content-type') ?? '';
      if (bodyStream) {
        const text = await new Response(bodyStream).text();
        if (ct.includes('json') || ct === '') {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      } else {
        const text = await response.text();
        if (ct.includes('json') || ct === '') {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      }
    } else if (responseType === 'text') {
      if (bodyStream) {
        data = await new Response(bodyStream).text();
      } else {
        data = await response.text();
      }
    } else if (responseType === 'arraybuffer') {
      if (bodyStream) {
        data = await new Response(bodyStream).arrayBuffer();
      } else {
        data = await response.arrayBuffer();
      }
    } else if (responseType === 'blob') {
      if (bodyStream) {
        data = await new Response(bodyStream).blob();
      } else {
        data = await response.blob();
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError('Failed to parse response body', {
      code: 'ERR_PARSE',
      config: redactConfig(config, config.sensitiveHeaders),
      status: response.status,
      cause: err,
    });
  }

  // Step 7: run validator if configured
  if (config.validate) {
    data = await runValidator(
      data,
      config.validate,
      redactConfig(config, config.sensitiveHeaders),
      { data, status: response.status, statusText: response.statusText, headers: response.headers },
    );
  }

  // Step 8: build envelope with redacted config
  const envelope: HttpResponse<T> = {
    data: data as T,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config: redactConfig(config, config.sensitiveHeaders),
  };

  // Step 9: non-2xx → throw
  if (!response.ok) {
    throw new HttpError(`Request failed with status ${response.status}`, {
      code: 'ERR_HTTP_STATUS',
      status: response.status,
      config: envelope.config,
      response: envelope as HttpResponse<unknown>,
    });
  }

  // Step 10: response interceptor chain
  const result = await context.responseInterceptors.run(
    envelope as HttpResponse<unknown>,
  );

  // Step 11: finally (handled by callers; timers auto-clear via AbortSignal)
  return result as HttpResponse<T>;
}

// ---- helpers ----------------------------------------------------------------

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
