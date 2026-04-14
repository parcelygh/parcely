// ---------------------------------------------------------------------------
// @parcely/react — useQuery hook
// ---------------------------------------------------------------------------

import { useReducer, useEffect, useRef, useCallback, useContext } from 'react';
import type { Validator, ValidatorOutput, HttpResponse, RequestConfig } from '@parcely/core';
import { HttpError } from '@parcely/core';
import { ParcelyContext } from './context.js';
import { deriveKey } from './keys.js';
import { fetchOrDedup } from './dedup.js';
import type { UseQueryOptions, UseQueryResult } from './types.js';

// ---- State machine --------------------------------------------------------

type Status = 'idle' | 'loading' | 'success' | 'error';

interface State<T> {
  status: Status;
  data: T | undefined;
  error: HttpError | undefined;
}

type Action<T> =
  | { type: 'loading' }
  | { type: 'success'; data: T }
  | { type: 'error'; error: HttpError };

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'loading':
      return { status: 'loading', data: state.data, error: undefined };
    case 'success':
      return { status: 'success', data: action.data, error: undefined };
    case 'error':
      return { status: 'error', data: undefined, error: action.error };
  }
}

// ---- Overloads ------------------------------------------------------------

/**
 * Fetch data from the given URL. When `validate` is provided, the response
 * data type is narrowed to the validator's output type.
 */
export function useQuery<V extends Validator<unknown>>(
  url: string,
  options: UseQueryOptions<V> & { validate: V },
): UseQueryResult<ValidatorOutput<V>>;
export function useQuery<T = unknown>(
  url: string,
  options?: UseQueryOptions<Validator<unknown>>,
): UseQueryResult<T>;
export function useQuery(
  url: string,
  options?: UseQueryOptions<Validator<unknown>>,
): UseQueryResult<unknown> {
  const ctxClient = useContext(ParcelyContext);
  const client = options?.client ?? ctxClient;

  if (!client) {
    throw new Error(
      'useQuery: no client available. Wrap your app in <ParcelyProvider> ' +
        'or pass `client` in options.',
    );
  }

  const enabled = options?.enabled ?? true;
  const params = options?.params;
  const headers = options?.headers;
  const timeout = options?.timeout;
  const validate = options?.validate;

  const baseKey = deriveKey('GET', url, params);

  // fetchCount is used to force a new fetch on refetch(), bypassing dedup
  const fetchCountRef = useRef(0);
  const [fetchTrigger, setFetchTrigger] = useReducer((x: number) => x + 1, 0);

  const initialState: State<unknown> = {
    status: enabled ? 'loading' : 'idle',
    data: undefined,
    error: undefined,
  };
  const [state, dispatch] = useReducer(reducer<unknown>, initialState);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    dispatch({ type: 'loading' });

    // Append fetchCount to key so refetch bypasses dedup
    const count = fetchCountRef.current;
    const key = count === 0 ? baseKey : `${baseKey}:${String(count)}`;

    const config: RequestConfig = { signal: controller.signal };
    if (params !== undefined) config.params = params;
    if (headers !== undefined) config.headers = headers;
    if (timeout !== undefined) config.timeout = timeout;
    if (validate !== undefined) config.validate = validate;

    fetchOrDedup(key, () => client.get(url, config))
      .then((response: HttpResponse<unknown>) => {
        if (!cancelled) {
          dispatch({ type: 'success', data: response.data });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          dispatch({
            type: 'error',
            error:
              err instanceof HttpError
                ? err
                : new HttpError(String(err), {
                    code: 'ERR_NETWORK',
                    config: { url },
                  }),
          });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, enabled, fetchTrigger]);

  const refetch = useCallback(() => {
    fetchCountRef.current += 1;
    setFetchTrigger();
  }, []);

  return {
    data: state.data,
    error: state.error,
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    refetch,
  };
}
