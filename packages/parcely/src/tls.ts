// ---------------------------------------------------------------------------
// parcely — TLS dispatcher (Node-only)
// ---------------------------------------------------------------------------

import type { TlsConfig } from './types.js';

let browserWarned = false;
let insecureWarned = false;

// Runtime-only references to Node globals (avoid compile-time dependency on @types/node)
declare const process: { release?: { name?: string }; env?: Record<string, string | undefined> } | undefined;

/**
 * Resolve an undici Agent dispatcher when TLS options are set.
 *
 * - Returns undefined in browsers (one-shot console.warn if tls is set).
 * - Lazy `await import('undici')` on Node.
 * - One-shot warn when rejectUnauthorized === false in non-production.
 */
export async function resolveDispatcher(
  tls: TlsConfig | undefined,
): Promise<unknown> {
  if (tls === undefined) return undefined;

  // Browser detection
  if (typeof process === 'undefined' || process.release?.name !== 'node') {
    if (!browserWarned) {
      browserWarned = true;
      console.warn(
        '[parcely] TLS options are ignored in browser environments.',
      );
    }
    return undefined;
  }

  // Node path
  if (tls.rejectUnauthorized === false) {
    const env = process.env?.['NODE_ENV'] ?? '';
    if (env !== 'production' && !insecureWarned) {
      insecureWarned = true;
      console.warn(
        '[parcely] TLS certificate verification is disabled (rejectUnauthorized: false). ' +
          'This is unsafe outside of local development.',
      );
    }
  }

  try {
    // Dynamic import — only resolves in Node environments with undici available
    const undici = await (Function('return import("undici")')() as Promise<{ Agent: new (opts: unknown) => unknown }>);
    const Agent = undici.Agent;
    return new Agent({
      connect: {
        rejectUnauthorized: tls.rejectUnauthorized,
        ca: tls.ca,
      },
    });
  } catch {
    // undici is an optionalDependency; on some platforms (or after a --no-optional
    // install) it won't be present. Be loud — silently ignoring TLS config would
    // leave a rejectUnauthorized:false request being made WITH cert verification
    // still enforced, which is a confusing failure mode.
    throw new Error(
      '[parcely] tls options were provided but the `undici` package is not installed. ' +
        'Install it as a dependency to enable TLS customisation on Node:\n' +
        '    npm install undici\n' +
        "    # or: pnpm add undici  /  yarn add undici\n" +
        'If you do not need TLS customisation, remove the `tls` option from your client config.',
    );
  }
}

/**
 * Reset internal one-shot warning flags (for testing purposes).
 */
export function _resetTlsWarnings(): void {
  browserWarned = false;
  insecureWarned = false;
}
