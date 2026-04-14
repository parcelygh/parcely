import { describe, it, expect, vi } from 'vitest';
import { mutationOptions } from './mutation-options.js';
import { mockClient, makeResponse } from '../test-utils.js';

describe('mutationOptions', () => {
  it('returns correct mutationKey', () => {
    const client = mockClient();
    const result = mutationOptions(client, 'POST', '/users');

    expect(result.mutationKey).toEqual(['parcely', 'POST', '/users']);
  });

  it('mutationKey uppercases the method', () => {
    const client = mockClient();
    const result = mutationOptions(client, 'post', '/users');

    expect(result.mutationKey).toEqual(['parcely', 'POST', '/users']);
  });

  it('mutationFn calls client.request with body', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockResolvedValueOnce(makeResponse({ id: 1 }));

    const result = mutationOptions(client, 'POST', '/users');
    await result.mutationFn({ name: 'Mickey' });

    expect(client.request).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(client.request).mock.calls[0]!;
    expect(callArgs[0]).toMatchObject({
      method: 'POST',
      url: '/users',
      body: { name: 'Mickey' },
    });
  });

  it('mutationFn returns response.data', async () => {
    const client = mockClient();
    vi.mocked(client.request).mockResolvedValueOnce(
      makeResponse({ id: 1, created: true }),
    );

    const result = mutationOptions(client, 'POST', '/users');
    const data = await result.mutationFn({ name: 'Mickey' });

    expect(data).toEqual({ id: 1, created: true });
  });
});
