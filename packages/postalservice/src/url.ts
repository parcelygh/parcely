// ---------------------------------------------------------------------------
// postalservice — URL builder
// ---------------------------------------------------------------------------

import type { RequestConfig } from './types.js';
import { HttpError } from './errors.js';

/**
 * Build a fully-resolved URL from config, merging baseURL + url + params.
 * Enforces allowAbsoluteUrls and allowedProtocols.
 */
export function buildUrl(config: RequestConfig): URL {
  const {
    baseURL,
    url = '',
    params,
    allowAbsoluteUrls,
    allowedProtocols = ['http:', 'https:'],
  } = config;

  // Determine if the url is absolute (has a scheme) or protocol-relative
  const isProtocolRelative = url.startsWith('//');
  const isAbsolute = isProtocolRelative || /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url);

  // When baseURL is set, reject absolute URLs unless explicitly allowed
  const shouldRejectAbsolute = baseURL !== undefined && baseURL !== '';
  const allowAbsolute = allowAbsoluteUrls ?? (shouldRejectAbsolute ? false : true);

  if (isAbsolute && !allowAbsolute) {
    throw new HttpError(
      `Absolute URL "${url}" is not allowed when baseURL is set`,
      { code: 'ERR_ABSOLUTE_URL', config },
    );
  }

  // Build the final URL
  let resolved: URL;
  try {
    if (baseURL && !isAbsolute) {
      const base = typeof baseURL === 'string' ? baseURL : baseURL.href;
      // Ensure base ends with / for proper resolution when url is relative
      const normalizedBase = base.endsWith('/') ? base : base + '/';
      // Remove leading / from url so relative resolution works correctly
      const normalizedUrl = url.startsWith('/') ? url.slice(1) : url;
      resolved = new URL(normalizedUrl, normalizedBase);
    } else {
      resolved = new URL(url);
    }
  } catch {
    throw new HttpError(
      `Invalid URL: "${url}"${baseURL ? ` (baseURL: "${String(baseURL)}")` : ''}`,
      { code: 'ERR_NETWORK', config },
    );
  }

  // Enforce allowedProtocols
  if (!allowedProtocols.includes(resolved.protocol)) {
    throw new HttpError(
      `Protocol "${resolved.protocol}" is not allowed (allowed: ${allowedProtocols.join(', ')})`,
      { code: 'ERR_DISALLOWED_PROTOCOL', config },
    );
  }

  // Serialize params
  if (params) {
    const searchParams = resolved.searchParams;
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v !== null && v !== undefined) {
            searchParams.append(key, String(v));
          }
        }
      } else {
        searchParams.set(key, String(value));
      }
    }
  }

  return resolved;
}
