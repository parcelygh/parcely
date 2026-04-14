import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ParcelyProvider, useParcelyClient } from './context.js';
import { mockClient } from './test-utils.js';

describe('ParcelyProvider + useParcelyClient', () => {
  it('provider passes client to useParcelyClient', () => {
    const client = mockClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ParcelyProvider client={client}>{children}</ParcelyProvider>
    );
    const { result } = renderHook(() => useParcelyClient(), { wrapper });
    expect(result.current).toBe(client);
  });

  it('useParcelyClient throws without provider', () => {
    expect(() => {
      renderHook(() => useParcelyClient());
    }).toThrow(/no <ParcelyProvider>/);
  });
});
