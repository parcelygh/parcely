// ---------------------------------------------------------------------------
// postalservice — config redaction
// ---------------------------------------------------------------------------

import type { RequestConfig } from './types.js';

/** Default headers whose values are replaced with '[REDACTED]'. */
const DEFAULT_SENSITIVE_HEADERS: ReadonlyArray<string> = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
];

/**
 * Shallow-clone config; replace values of sensitive headers with '[REDACTED]'.
 * Case-insensitive matching. Does not mutate the input.
 */
export function redactConfig(
  config: RequestConfig,
  sensitiveHeaders?: string[],
): RequestConfig {
  const sensitiveSet = new Set(
    (sensitiveHeaders ?? DEFAULT_SENSITIVE_HEADERS).map((h) => h.toLowerCase()),
  );

  const cloned: RequestConfig = { ...config };

  if (cloned.headers) {
    if (cloned.headers instanceof Headers) {
      const redacted = new Headers();
      cloned.headers.forEach((value, key) => {
        redacted.set(key, sensitiveSet.has(key.toLowerCase()) ? '[REDACTED]' : value);
      });
      cloned.headers = redacted;
    } else if (Array.isArray(cloned.headers)) {
      cloned.headers = cloned.headers.map(([key, value]): [string, string] => [
        key,
        sensitiveSet.has(key.toLowerCase()) ? '[REDACTED]' : value,
      ]);
    } else {
      const redacted: Record<string, string> = {};
      for (const key of Object.keys(cloned.headers)) {
        redacted[key] = sensitiveSet.has(key.toLowerCase())
          ? '[REDACTED]'
          : cloned.headers[key]!;
      }
      cloned.headers = redacted;
    }
  }

  return cloned;
}
