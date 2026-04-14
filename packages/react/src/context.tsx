// ---------------------------------------------------------------------------
// @parcely/react — React context provider
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Client } from '@parcely/core';

const ParcelyContext = createContext<Client | null>(null);

/**
 * Provide a parcely {@link Client} to all descendant hooks.
 *
 * ```tsx
 * <ParcelyProvider client={http}>
 *   <App />
 * </ParcelyProvider>
 * ```
 */
export function ParcelyProvider({
  client,
  children,
}: {
  client: Client;
  children: ReactNode;
}): ReactNode {
  return (
    <ParcelyContext.Provider value={client}>{children}</ParcelyContext.Provider>
  );
}

/**
 * Read the parcely client from context. Throws if no `<ParcelyProvider>` is
 * found and no explicit `client` option was passed to the calling hook.
 */
export function useParcelyClient(): Client {
  const client = useContext(ParcelyContext);
  if (!client) {
    throw new Error(
      'useParcelyClient: no <ParcelyProvider> found. Either wrap your app ' +
        'in <ParcelyProvider client={...}> or pass `client` in hook options.',
    );
  }
  return client;
}

export { ParcelyContext };
