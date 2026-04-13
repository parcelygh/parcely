// ---------------------------------------------------------------------------
// parcely — interceptor chain
// ---------------------------------------------------------------------------

export interface InterceptorEntry<T> {
  fulfilled: ((value: T) => T | Promise<T>) | undefined;
  rejected: ((err: unknown) => unknown) | undefined;
}

export interface InterceptorChain<T> {
  use(
    onFulfilled?: (value: T) => T | Promise<T>,
    onRejected?: (err: unknown) => unknown,
  ): number;
  eject(id: number): void;
  run(value: T): Promise<T>;
}

/**
 * Create an interceptor chain with axios-compatible semantics.
 *
 * - Handlers run in insertion order.
 * - Rejected handlers can recover (return) or rethrow.
 * - Fulfilled handlers can return values or promises.
 * - Ejected slots are skipped.
 */
export function createInterceptorChain<T>(): InterceptorChain<T> {
  const handlers: Array<InterceptorEntry<T> | null> = [];

  return {
    use(
      onFulfilled?: (value: T) => T | Promise<T>,
      onRejected?: (err: unknown) => unknown,
    ): number {
      handlers.push({ fulfilled: onFulfilled, rejected: onRejected });
      return handlers.length - 1;
    },

    eject(id: number): void {
      if (id >= 0 && id < handlers.length) {
        handlers[id] = null;
      }
    },

    async run(value: T): Promise<T> {
      let result: T | Promise<T> = value;
      let isError = false;

      for (const handler of handlers) {
        if (handler === null) continue;

        if (isError) {
          if (handler.rejected) {
            try {
              result = handler.rejected(result) as T;
              isError = false;
            } catch (err) {
              result = err as T;
              isError = true;
            }
          }
          // If no rejected handler, stay on error path
        } else {
          if (handler.fulfilled) {
            try {
              result = await handler.fulfilled(result as T);
              isError = false;
            } catch (err) {
              result = err as T;
              isError = true;
            }
          }
          // If no fulfilled handler, pass through
        }
      }

      if (isError) {
        throw result;
      }

      return result as T;
    },
  };
}
