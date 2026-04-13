// ---------------------------------------------------------------------------
// postalservice — client factory
// ---------------------------------------------------------------------------

import type { RequestConfig, HttpResponse, Client, InterceptorManager, InterceptorHandler } from './types.js';
import { createInterceptorChain } from './interceptors.js';
import { send } from './request.js';

/**
 * Create a postalservice client instance.
 */
export function createClient(defaults: RequestConfig = {}): Client {
  const requestChain = createInterceptorChain<RequestConfig>();
  const responseChain = createInterceptorChain<HttpResponse<unknown>>();

  const requestManager: InterceptorManager<RequestConfig> = {
    use(
      onFulfilledOrHandler?: ((value: RequestConfig) => RequestConfig | Promise<RequestConfig>) | InterceptorHandler<RequestConfig>,
      onRejected?: (err: unknown) => unknown,
    ): number {
      if (typeof onFulfilledOrHandler === 'object' && onFulfilledOrHandler !== null) {
        return requestChain.use(onFulfilledOrHandler.fulfilled, onFulfilledOrHandler.rejected);
      }
      return requestChain.use(onFulfilledOrHandler as (value: RequestConfig) => RequestConfig | Promise<RequestConfig>, onRejected);
    },
    eject(id: number): void {
      requestChain.eject(id);
    },
  };

  const responseManager: InterceptorManager<HttpResponse<unknown>> = {
    use(
      onFulfilledOrHandler?:
        | ((value: HttpResponse<unknown>) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>)
        | InterceptorHandler<HttpResponse<unknown>>,
      onRejected?: (err: unknown) => unknown,
    ): number {
      if (typeof onFulfilledOrHandler === 'object' && onFulfilledOrHandler !== null) {
        return responseChain.use(onFulfilledOrHandler.fulfilled, onFulfilledOrHandler.rejected);
      }
      return responseChain.use(
        onFulfilledOrHandler as (value: HttpResponse<unknown>) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>,
        onRejected,
      );
    },
    eject(id: number): void {
      responseChain.eject(id);
    },
  };

  const context = {
    defaults,
    requestInterceptors: requestChain,
    responseInterceptors: responseChain,
  };

  function request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
    return send<T>(config, context);
  }

  const client: Client = {
    defaults,

    interceptors: {
      request: requestManager,
      response: responseManager,
    },

    request,

    get<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'GET' });
    },

    delete<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'DELETE' });
    },

    head<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'HEAD' });
    },

    options<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'OPTIONS' });
    },

    post<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'POST', body });
    },

    put<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'PUT', body });
    },

    patch<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>> {
      return request<T>({ ...config, url, method: 'PATCH', body });
    },
  };

  return client;
}
