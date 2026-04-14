// ---------------------------------------------------------------------------
// @parcely/react — useMutation hook
// ---------------------------------------------------------------------------

import { useReducer, useCallback, useContext } from 'react';
import type { Validator, ValidatorOutput, HttpResponse, RequestConfig } from '@parcely/core';
import { HttpError } from '@parcely/core';
import { ParcelyContext } from './context.js';
import type { UseMutationOptions, UseMutationResult } from './types.js';

// ---- State machine --------------------------------------------------------

type Status = 'idle' | 'pending' | 'success' | 'error';

interface State<T> {
  status: Status;
  data: T | undefined;
  error: HttpError | undefined;
}

type Action<T> =
  | { type: 'pending' }
  | { type: 'success'; data: T }
  | { type: 'error'; error: HttpError }
  | { type: 'reset' };

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'pending':
      return { status: 'pending', data: undefined, error: undefined };
    case 'success':
      return { status: 'success', data: action.data, error: undefined };
    case 'error':
      return { status: 'error', data: undefined, error: action.error };
    case 'reset':
      return { status: 'idle', data: undefined, error: undefined };
  }
}

// ---- Overloads ------------------------------------------------------------

/**
 * Fire a mutation (POST, PUT, PATCH, DELETE, etc.). Does NOT abort on
 * unmount — a mutation that reached the server should not be cancelled
 * client-side.
 */
export function useMutation<V extends Validator<unknown>>(
  method: string,
  url: string,
  options: UseMutationOptions<V> & { validate: V },
): UseMutationResult<ValidatorOutput<V>>;
export function useMutation<T = unknown>(
  method: string,
  url: string,
  options?: UseMutationOptions<Validator<unknown>>,
): UseMutationResult<T>;
export function useMutation(
  method: string,
  url: string,
  options?: UseMutationOptions<Validator<unknown>>,
): UseMutationResult<unknown> {
  const ctxClient = useContext(ParcelyContext);
  const client = options?.client ?? ctxClient;

  if (!client) {
    throw new Error(
      'useMutation: no client available. Wrap your app in <ParcelyProvider> ' +
        'or pass `client` in options.',
    );
  }

  const params = options?.params;
  const headers = options?.headers;
  const timeout = options?.timeout;
  const validate = options?.validate;

  const initialState: State<unknown> = {
    status: 'idle',
    data: undefined,
    error: undefined,
  };
  const [state, dispatch] = useReducer(reducer<unknown>, initialState);

  const mutateAsync = useCallback(
    (body?: unknown): Promise<HttpResponse<unknown>> => {
      dispatch({ type: 'pending' });

      const config: RequestConfig = { method, url, body };
      if (params !== undefined) config.params = params;
      if (headers !== undefined) config.headers = headers;
      if (timeout !== undefined) config.timeout = timeout;
      if (validate !== undefined) config.validate = validate;

      const promise = client.request(config);

      promise.then(
        (response: HttpResponse<unknown>) => {
          dispatch({ type: 'success', data: response.data });
        },
        (err: unknown) => {
          dispatch({
            type: 'error',
            error:
              err instanceof HttpError
                ? err
                : new HttpError(String(err), {
                    code: 'ERR_NETWORK',
                    config: { method, url },
                  }),
          });
        },
      );

      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, method, url, params, headers, timeout, validate],
  );

  const mutate = useCallback(
    (body?: unknown): void => {
      void mutateAsync(body);
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  return {
    mutate,
    mutateAsync,
    isPending: state.status === 'pending',
    isError: state.status === 'error',
    isSuccess: state.status === 'success',
    error: state.error,
    data: state.data,
    reset,
  };
}
