// ---------------------------------------------------------------------------
// @parcely/react — query key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a stable, serialized cache key from a method, URL, and optional
 * params object. Param keys are sorted alphabetically so that
 * `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }` produce the same key.
 *
 * @returns A JSON string: `'["parcely","GET","/users","{\\"a\\":2}"]'`
 */
export function deriveKey(
  method: string,
  url: string,
  params?: Record<string, unknown>,
): string {
  const sorted: Record<string, unknown> = {};
  if (params) {
    const keys = Object.keys(params).sort();
    for (const k of keys) {
      sorted[k] = params[k];
    }
  }
  return JSON.stringify([
    'parcely',
    method.toUpperCase(),
    url,
    JSON.stringify(sorted),
  ]);
}
