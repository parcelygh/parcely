// ---------------------------------------------------------------------------
// parcely — header merging
// ---------------------------------------------------------------------------

import type { HeadersInit, RequestConfig } from './types.js';
import { HttpError } from './errors.js';

/** Keys to strip from plain-object header sources (prototype pollution defense). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Merge multiple header sources (left → right priority) into a native Headers.
 *
 * - Strips `__proto__` / `constructor` / `prototype` from plain objects.
 * - CRLF injection caught by native Headers constructor → rethrown as ERR_CRLF_INJECTION.
 * - Optionally enforces an allowedRequestHeaders allowlist.
 */
export function mergeHeaders(
  ...sources: Array<HeadersInit | undefined>
): Headers;
export function mergeHeaders(
  ...args: Array<HeadersInit | undefined>
): Headers {
  const merged = new Headers();

  for (const source of args) {
    if (source === undefined || source === null) continue;

    if (source instanceof Headers) {
      source.forEach((value, key) => {
        setHeader(merged, key, value);
      });
    } else if (Array.isArray(source)) {
      for (const [key, value] of source) {
        setHeader(merged, key, value);
      }
    } else {
      // Plain object
      for (const key of Object.keys(source)) {
        if (DANGEROUS_KEYS.has(key)) continue;
        setHeader(merged, key, source[key]!);
      }
    }
  }

  return merged;
}

function setHeader(headers: Headers, key: string, value: string): void {
  try {
    headers.set(key, value);
  } catch (err) {
    // Native Headers throws TypeError on CRLF in values
    if (err instanceof TypeError) {
      throw new HttpError(
        `Invalid header value for "${key}": CRLF injection detected`,
        {
          code: 'ERR_CRLF_INJECTION',
          config: {} as RequestConfig,
          cause: err,
        },
      );
    }
    throw err;
  }
}

/**
 * Enforce allowedRequestHeaders if configured.
 * Throws ERR_DISALLOWED_HEADER for any header not in the allowlist.
 */
export function enforceAllowedHeaders(
  headers: Headers,
  allowedRequestHeaders: string[] | undefined,
  config: RequestConfig,
): void {
  if (!allowedRequestHeaders || allowedRequestHeaders.length === 0) return;

  const allowed = new Set(allowedRequestHeaders.map((h) => h.toLowerCase()));

  headers.forEach((_value, key) => {
    if (!allowed.has(key.toLowerCase())) {
      throw new HttpError(
        `Header "${key}" is not in the allowed request headers list`,
        { code: 'ERR_DISALLOWED_HEADER', config },
      );
    }
  });
}
