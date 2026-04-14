// ---------------------------------------------------------------------------
// @parcely/react — public barrel
// ---------------------------------------------------------------------------

// Context
export { ParcelyProvider, useParcelyClient } from './context.js';

// Hooks
export { useQuery } from './use-query.js';
export { useSuspenseQuery } from './use-suspense-query.js';
export { useMutation } from './use-mutation.js';

// Types
export type {
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryResult,
  UseMutationOptions,
  UseMutationResult,
} from './types.js';
