import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from './client.js';
import { HttpError } from './errors.js';
import { installFetchStub, jsonResponse } from '../test/fetch-stub.js';

describe('createClient', () => {
  let fetchMock: ReturnType<typeof installFetchStub>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = installFetchStub();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('defaults merging: baseURL applied to every request', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await http.get('/users');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.example.com/users');
  });

  it('method sugar: get delegates to request', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const result = await http.get<{ id: number }>('/users/1');

    expect(result.data).toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('GET');
  });

  it('method sugar: post sends body', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 2 }));

    await http.post('/users', { name: 'test' });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    // Body should be JSON string
    expect(typeof init.body === 'string' || init.body instanceof ReadableStream).toBe(true);
  });

  it('method sugar: put, patch, delete, head, options work', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });

    for (const method of ['put', 'patch'] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await http[method]('/resource', { data: 1 });
      const lastCall = fetchMock.mock.calls.at(-1)!;
      expect(lastCall[1]?.method).toBe(method.toUpperCase());
    }

    for (const method of ['delete', 'head', 'options'] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await http[method]('/resource');
      const lastCall = fetchMock.mock.calls.at(-1)!;
      expect(lastCall[1]?.method).toBe(method.toUpperCase());
    }
  });

  it('interceptors: request interceptor modifies config', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    http.interceptors.request.use((cfg) => ({
      ...cfg,
      headers: { ...cfg.headers as Record<string, string>, 'X-Custom': 'intercepted' },
    }));

    await http.get('/data');

    const headers = fetchMock.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('x-custom')).toBe('intercepted');
  });

  it('interceptors: response interceptor modifies response', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 1 }));

    http.interceptors.response.use((res) => ({
      ...res,
      data: { ...(res.data as Record<string, unknown>), extra: true },
    }));

    const result = await http.get('/data');
    expect(result.data).toEqual({ count: 1, extra: true });
  });

  it('interceptors: eject removes interceptor', async () => {
    const http = createClient({ baseURL: 'https://api.example.com' });
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const id = http.interceptors.request.use((cfg) => ({
      ...cfg,
      headers: { 'X-Should-Not-Exist': 'true' },
    }));

    http.interceptors.request.eject(id);

    await http.get('/data');

    const headers = fetchMock.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('x-should-not-exist')).toBeNull();
  });

  it('exposes defaults on the client', () => {
    const http = createClient({
      baseURL: 'https://api.example.com',
      timeout: 5000,
    });
    expect(http.defaults.baseURL).toBe('https://api.example.com');
    expect(http.defaults.timeout).toBe(5000);
  });
});
