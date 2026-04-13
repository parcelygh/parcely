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

  let undici: { Agent: new (opts: unknown) => unknown };
  try {
    // Hide the import specifier from bundlers' static analysis by routing
    // through a variable. Most bundlers (esbuild, Rollup, Webpack) resolve
    // dynamic-import specifiers only when they are string literals; a
    // variable defeats that pass and leaves the import as a true runtime
    // operation.
    //
    // Why we hide it:
    //   - undici is a Node-only optional dep. Browser consumers MUST NOT
    //     have it pulled into their bundle even when their code path can't
    //     reach this function. Bundlers attempt to resolve all literal
    //     specifiers up-front, and undici's deep `node:*` requires would
    //     blow up a browser build.
    //
    // Why not `Function('return import("undici")')()`:
    //   - requires `unsafe-eval` CSP
    //   - tripped by security scanners
    //   - same effect but uglier and more dangerous than this variable.
    //
    // The browser path above (process.release.name !== 'node') already
    // short-circuits before this line, so no browser runtime ever attempts
    // the import — and the variable trick keeps bundlers from attempting
    // it at build time either.
    const moduleName = 'undici';
    undici = (await import(moduleName)) as unknown as {
      Agent: new (opts: unknown) => unknown;
    };
  } catch {
    // undici is an optionalDependency; on some platforms (or after a
    // --no-optional install) it won't be present. Be loud — silently
    // ignoring TLS config would leave a rejectUnauthorized:false request
    // being made WITH cert verification still enforced, which is a
    // confusing failure mode.
    throw new Error(
      '[parcely] tls options were provided but the `undici` package is not installed. ' +
        'Install it as a dependency to enable TLS customisation on Node:\n' +
        '    npm install undici\n' +
        "    # or: pnpm add undici  /  yarn add undici\n" +
        'If you do not need TLS customisation, remove the `tls` option from your client config.',
    );
  }

  const Agent = undici.Agent;
  return new Agent({
    connect: {
      rejectUnauthorized: tls.rejectUnauthorized,
      ca: tls.ca,
    },
  });
}

/**
 * Reset internal one-shot warning flags (for testing purposes).
 */
export function _resetTlsWarnings(): void {
  browserWarned = false;
  insecureWarned = false;
}
