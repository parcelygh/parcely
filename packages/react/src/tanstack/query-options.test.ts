import { describe, it, expect, vi } from 'vitest';
import { queryOptions } from './query-options.js';
import { mockClient, makeResponse } from '../test-utils.js';

describe('queryOptions', () => {
  it('returns correct queryKey shape', () => {
    const client = mockClient();
    const result = queryOptions(client, '/users/me', { params: { include: 'org' } });

    expect(result.queryKey).toEqual([
      'parcely',
      'GET',
      '/users/me',
      '{"include":"org"}',
    ]);
  });

  it('queryKey with no params serializes as {}', () => {
    const client = mockClient();
    const result = queryOptions(client, '/users/me');

    expect(result.queryKey).toEqual(['parcely', 'GET', '/users/me', '{}']);
  });

  it('queryFn calls client.get with the signal from context', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(makeResponse({ name: 'Mickey' }));

    const result = queryOptions(client, '/users/me', { params: { x: 1 } });

    const signal = new AbortController().signal;
    await result.queryFn({ signal });

    expect(client.get).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(client.get).mock.calls[0]!;
    expect(callArgs[0]).toBe('/users/me');
    expect(callArgs[1]).toMatchObject({ signal, params: { x: 1 } });
  });

  it('queryFn returns response.data (not the full envelope)', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(makeResponse({ id: 42 }));

    const result = queryOptions(client, '/items/42');
    const signal = new AbortController().signal;
    const data = await result.queryFn({ signal });

    expect(data).toEqual({ id: 42 });
  });

  it('validate type flows through (verify shape of returned data)', async () => {
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(makeResponse({ id: 1, name: 'Test' }));

    const validator = (input: unknown) => input as { id: number; name: string };
    const result = queryOptions(client, '/users/1', { validate: validator });

    const signal = new AbortController().signal;
    const data = await result.queryFn({ signal });

    expect(data).toEqual({ id: 1, name: 'Test' });
  });
});
