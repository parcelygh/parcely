// ---------------------------------------------------------------------------
// postalservice — test helper: fetch stub
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

export type FetchStub = ReturnType<typeof vi.fn<typeof fetch>>;

/**
 * Install a stubbed `globalThis.fetch` for the duration of a test.
 * Returns the mock so callers can configure per-test responses.
 *
 * Usage:
 *   const fetchMock = installFetchStub();
 *   fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));
 */
export function installFetchStub(): FetchStub {
  const mock = vi.fn<typeof fetch>();
  const originalFetch = globalThis.fetch;

  // Install
  globalThis.fetch = mock as unknown as typeof fetch;

  // Return a mock that auto-restores in afterEach is fine, but we also
  // expose restore explicitly
  (mock as FetchStub & { restore: () => void }).restore = () => {
    globalThis.fetch = originalFetch;
  };

  return mock;
}

/**
 * Create a Response that returns JSON.
 */
export function jsonResponse(
  body: unknown,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/**
 * Create a Response with text content.
 */
export function textResponse(
  body: string,
  init?: ResponseInit,
): Response {
  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    ...init,
  });
}

/**
 * Create a redirect Response.
 */
export function redirectResponse(
  location: string,
  status = 302,
): Response {
  return new Response(null, {
    status,
    statusText: 'Found',
    headers: { location },
  });
}
