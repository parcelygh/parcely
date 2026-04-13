// ---------------------------------------------------------------------------
// postalservice — body preparation
// ---------------------------------------------------------------------------

import type { FormDataSerializer, RequestConfig } from './types.js';

export interface PreparedBody {
  body: BodyInit | ReadableStream | undefined;
  headers?: Record<string, string>;
}

// Uint8Array<ArrayBufferLike> is not directly assignable to BodyInit in TS 6+,
// so we cast via unknown.
function toBodyInit(input: Uint8Array): BodyInit {
  return input as unknown as BodyInit;
}

/**
 * Prepare a request body and derive content-type headers.
 */
export function prepareBody(
  input: unknown,
  config: RequestConfig,
): PreparedBody {
  // undefined / null → no body
  if (input === undefined || input === null) {
    return { body: undefined };
  }

  const userHeaders = normalizeUserHeaders(config.headers);

  // FormData → stream via new Response(formData) for multipart boundary
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    return prepareFormData(input);
  }

  // Blob
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const headers: Record<string, string> = {};
    if (input.type && !hasContentType(userHeaders)) {
      headers['content-type'] = input.type;
    }
    return { body: input, headers };
  }

  // ArrayBuffer
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return { body: input };
  }

  // Uint8Array
  if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) {
    return { body: toBodyInit(input) };
  }

  // ReadableStream
  if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
    return { body: input as ReadableStream };
  }

  // String
  if (typeof input === 'string') {
    return { body: input };
  }

  // Node Readable / async iterable (detect via pipe or Symbol.asyncIterator)
  if (isNodeReadable(input)) {
    const stream = convertNodeReadable(input);
    return { body: stream as BodyInit };
  }

  // Plain object checks
  if (isPlainObject(input)) {
    // Check if object contains File/Blob → auto FormData
    if (containsFileOrBlob(input as Record<string, unknown>)) {
      const serializer = config.formDataSerializer ?? 'brackets';
      const formData = objectToFormData(input as Record<string, unknown>, serializer);
      return prepareFormData(formData);
    }

    // Plain object → JSON
    const headers: Record<string, string> = {};
    if (!hasContentType(userHeaders)) {
      headers['content-type'] = 'application/json';
    }
    return { body: JSON.stringify(input), headers };
  }

  // Fallback: try JSON
  const headers: Record<string, string> = {};
  if (!hasContentType(userHeaders)) {
    headers['content-type'] = 'application/json';
  }
  return { body: JSON.stringify(input), headers };
}

// ---- FormData helpers -------------------------------------------------------

function prepareFormData(formData: FormData): PreparedBody {
  // Use new Response(formData) to get a stream + correct multipart Content-Type
  const response = new Response(formData);
  const contentType = response.headers.get('content-type');
  const headers: Record<string, string> = {};
  if (contentType) {
    headers['content-type'] = contentType;
  }
  return {
    body: response.body ?? formData,
    headers,
  };
}

// ---- Object → FormData conversion ------------------------------------------

function objectToFormData(
  obj: Record<string, unknown>,
  serializer: FormDataSerializer,
): FormData {
  const fd = new FormData();
  appendToFormData(fd, obj, '', serializer);
  return fd;
}

function appendToFormData(
  fd: FormData,
  data: unknown,
  prefix: string,
  serializer: FormDataSerializer,
): void {
  if (data === null || data === undefined) return;

  if (isFileOrBlob(data)) {
    fd.append(prefix, data as Blob);
    return;
  }

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      let key: string;
      switch (serializer) {
        case 'indices':
          key = prefix ? `${prefix}[${i}]` : String(i);
          break;
        case 'repeat':
          key = prefix;
          break;
        case 'brackets':
        default:
          key = prefix ? `${prefix}[${i}]` : String(i);
          break;
      }
      appendToFormData(fd, data[i], key, serializer);
    }
    return;
  }

  if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      appendToFormData(fd, value, fullKey, serializer);
    }
    return;
  }

  // Primitive value
  fd.append(prefix, String(data));
}

// ---- Detection helpers ------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isFileOrBlob(value: unknown): boolean {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  return false;
}

function containsFileOrBlob(obj: Record<string, unknown>): boolean {
  for (const value of Object.values(obj)) {
    if (isFileOrBlob(value)) return true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isFileOrBlob(item)) return true;
        if (isPlainObject(item) && containsFileOrBlob(item as Record<string, unknown>)) {
          return true;
        }
      }
    }
    if (isPlainObject(value) && containsFileOrBlob(value as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
}

function isNodeReadable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof (value as Record<string, unknown>)['pipe'] === 'function' ||
    Symbol.asyncIterator in (value as Record<symbol, unknown>)
  );
}

function convertNodeReadable(input: unknown): ReadableStream | unknown {
  // Try ReadableStream.from if available (Node 20+)
  if (typeof ReadableStream !== 'undefined' && 'from' in ReadableStream) {
    try {
      return (ReadableStream as typeof ReadableStream & { from: (source: unknown) => ReadableStream }).from(
        input as AsyncIterable<Uint8Array>,
      );
    } catch {
      // Fall through
    }
  }
  // Hope undici handles it
  return input;
}

function normalizeUserHeaders(
  headers: RequestConfig['headers'],
): Map<string, string> {
  const map = new Map<string, string>();
  if (!headers) return map;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      map.set(key.toLowerCase(), value);
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      map.set(key.toLowerCase(), value);
    }
  } else {
    for (const key of Object.keys(headers)) {
      map.set(key.toLowerCase(), headers[key]!);
    }
  }
  return map;
}

function hasContentType(headers: Map<string, string>): boolean {
  return headers.has('content-type');
}
