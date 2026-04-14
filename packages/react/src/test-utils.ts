// ---------------------------------------------------------------------------
// @parcely/react — test utilities
// ---------------------------------------------------------------------------

import { vi } from 'vitest';
import type { Client, HttpResponse, RequestConfig } from '@parcely/core';

/** Create a mock response envelope. */
export function makeResponse<T>(data: T, status = 200): HttpResponse<T> {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    headers: new Headers(),
    config: {},
  };
}

/** Create a mock parcely Client with vi.fn() stubs. */
export function mockClient(overrides?: Partial<Client>): Client {
  return {
    defaults: {},
    interceptors: {
      request: { use: vi.fn(() => 0), eject: vi.fn() },
      response: { use: vi.fn(() => 0), eject: vi.fn() },
    },
    get: vi.fn(),
    request: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    options: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    ...overrides,
  } satisfies Client;
}

/** Helper to create a deferred promise for fine-grained control. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
