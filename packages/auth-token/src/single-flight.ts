// ---------------------------------------------------------------------------
// single-flight — refresh-coalescing promise store
// ---------------------------------------------------------------------------

/**
 * Creates a single-flight wrapper around an async function.
 *
 * When the returned function is called concurrently while the underlying
 * `fn` is in flight, **all callers receive the same `Promise`**. Once the
 * promise settles (resolve or reject), the next call triggers a fresh
 * `fn` invocation.
 *
 * This is the building block for coalescing concurrent 401-refresh attempts
 * into a single network call.
 *
 * @typeParam T - The resolved type of the wrapped function.
 * @param fn - The async function to wrap.
 * @returns A function with the same return type that deduplicates in-flight calls.
 *
 * @example
 * ```ts
 * const refreshOnce = createSingleFlight(() => refreshToken());
 * // Two concurrent calls share one refresh:
 * const [a, b] = await Promise.all([refreshOnce(), refreshOnce()]);
 * // a === b (same resolved value, single network call)
 * ```
 */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;

  return (): Promise<T> => {
    if (inflight !== null) {
      return inflight;
    }

    inflight = fn().finally(() => {
      inflight = null;
    });

    return inflight;
  };
}
