// ---------------------------------------------------------------------------
// parcely — config merging (prototype-pollution-safe)
// ---------------------------------------------------------------------------

import type { RequestConfig, HeadersInit } from './types.js';

/** Keys to strip from user-supplied objects (prototype pollution defense). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** All known RequestConfig keys (explicit allowlist). */
const CONFIG_KEYS: ReadonlyArray<keyof RequestConfig> = [
  'baseURL',
  'url',
  'method',
  'headers',
  'params',
  'body',
  'timeout',
  'signal',
  'responseType',
  'validate',
  'tls',
  'followRedirects',
  'maxRedirects',
  'redirect',
  'allowAbsoluteUrls',
  'allowedProtocols',
  'allowedRequestHeaders',
  'sensitiveHeaders',
  'formDataSerializer',
  'onUploadProgress',
  'onDownloadProgress',
];

/**
 * Merge defaults and per-call config into a new object.
 *
 * - Uses an explicit allowlist of known RequestConfig keys.
 * - Strips `__proto__` / `constructor` / `prototype` from nested objects.
 * - Does NOT mutate inputs.
 */
export function mergeConfig(
  defaults: RequestConfig,
  override: RequestConfig,
): RequestConfig {
  const result: Record<string, unknown> = {};

  for (const key of CONFIG_KEYS) {
    const defVal = defaults[key];
    const ovVal = override[key];

    if (key === 'headers') {
      // Merge headers: defaults first, override on top
      result[key] = mergeHeadersInit(
        defVal as HeadersInit | undefined,
        ovVal as HeadersInit | undefined,
      );
      continue;
    }

    if (key === 'params') {
      // Merge params objects, override wins per key
      const defParams = sanitizePlain(defVal as Record<string, unknown> | undefined);
      const ovParams = sanitizePlain(ovVal as Record<string, unknown> | undefined);
      if (defParams || ovParams) {
        result[key] = { ...defParams, ...ovParams };
      }
      continue;
    }

    // Scalar: override wins if present
    if (ovVal !== undefined) {
      result[key] = ovVal;
    } else if (defVal !== undefined) {
      result[key] = defVal;
    }
  }

  return result as RequestConfig;
}

// ---- helpers ----------------------------------------------------------------

function sanitizePlain(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = obj[key];
  }
  return out;
}

/**
 * Merge HeadersInit values without touching the originals.
 * Returns undefined if both inputs are undefined.
 */
function mergeHeadersInit(
  a: HeadersInit | undefined,
  b: HeadersInit | undefined,
): HeadersInit | undefined {
  if (!a && !b) return undefined;

  const merged: Record<string, string> = {};

  applySource(merged, a);
  applySource(merged, b);

  return merged;
}

function applySource(
  target: Record<string, string>,
  source: HeadersInit | undefined,
): void {
  if (!source) return;

  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target[key] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) {
      target[key.toLowerCase()] = value;
    }
  } else {
    for (const key of Object.keys(source)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      target[key.toLowerCase()] = source[key]!;
    }
  }
}
