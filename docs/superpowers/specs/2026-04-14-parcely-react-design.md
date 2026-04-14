# @parcely/react — design spec

## Context

parcely ships four packages (`@parcely/core`, `@parcely/auth-token`, `@parcely/auth-redirect`, `@parcely/retry`). React is the most common consumer context for HTTP clients, and the third code review flagged a React addon as the second-most-impactful feature after retry. This spec defines `@parcely/react` — standalone React hooks plus a TanStack Query adapter.

## Scope

Two entry points in one package:

1. **`@parcely/react`** — standalone hooks (`useQuery`, `useSuspenseQuery`, `useMutation`) + context provider. Dedup-only, no cache. The lightweight path for teams that don't want TanStack Query.

2. **`@parcely/react/tanstack`** — adapter helpers (`queryOptions`, `mutationOptions`) that wire parcely into TanStack Query. Pure functions returning `{ queryKey, queryFn }` / `{ mutationKey, mutationFn }`. TQ owns caching, invalidation, retries, devtools.

## Public API

### Provider (optional)

```tsx
import { ParcelyProvider, useParcelyClient } from '@parcely/react'

<ParcelyProvider client={http}>
  <App />
</ParcelyProvider>
```

All hooks read the client from context. Hooks also accept `client` in their options object as a fallback/override — no provider needed for simple apps or tests.

### useQuery

```ts
import { useQuery } from '@parcely/react'

const { data, error, isLoading, isSuccess, isError, refetch } = useQuery('/users/me', {
  validate: UserSchema,       // narrows data to z.infer<typeof UserSchema>
  params: { include: 'org' }, // merged into the request
  headers: { ... },           // per-request headers
  client: http,               // explicit — overrides provider
})
```

- Returns `{ data: T | undefined, error: HttpError | undefined, isLoading, isSuccess, isError, refetch: () => void }`
- URL is the first argument; client comes from context or options.
- Query key derived automatically from `['parcely', 'GET', url, serializedParams]`.
- Concurrent renders with the same key share one in-flight request (dedup).
- No cache — unmount and remount re-fetches.
- AbortSignal auto-wired: unmount aborts in-flight requests via useEffect cleanup.
- `refetch()` bypasses dedup and forces a fresh request.

### useSuspenseQuery

```ts
import { useSuspenseQuery } from '@parcely/react'

// Must be inside <Suspense> + <ErrorBoundary>
const { data, refetch } = useSuspenseQuery('/users/me', { validate: UserSchema })
// data is guaranteed non-null
```

- Same fetch/dedup logic as `useQuery`.
- Instead of returning `isLoading`, throws the in-flight promise (caught by `<Suspense>`).
- On error, throws `HttpError` (caught by `<ErrorBoundary>`).
- Return type: `{ data: T, refetch: () => void }` — `data` is non-optional.

### useMutation

```ts
import { useMutation } from '@parcely/react'

const { mutate, mutateAsync, isPending, isError, isSuccess, error, data, reset } = useMutation(
  'POST', '/users', { validate: CreatedUserSchema }
)

mutate({ name: 'Mickey' })          // fire-and-forget
const res = await mutateAsync(body)  // awaitable
reset()                              // clears state back to idle
```

- First arg: HTTP method. Second: URL. Third: options (validate, headers, client, etc.).
- `mutate(body)` fires the request, updates state.
- `mutateAsync(body)` returns the `Promise<HttpResponse<T>>`.
- No dedup (mutations are side-effectful).
- Does NOT abort on unmount (a POST that reached the server shouldn't be cancelled client-side).
- `reset()` clears state to idle.

### TanStack Query adapter (`@parcely/react/tanstack`)

```ts
import { queryOptions, mutationOptions } from '@parcely/react/tanstack'

const userQuery = queryOptions(http, '/users/me', { validate: UserSchema })
// → { queryKey: ['parcely', 'GET', '/users/me', '{}'], queryFn: ({ signal }) => ... }

const createUser = mutationOptions(http, 'POST', '/users')
// → { mutationKey: ['parcely', 'POST', '/users'], mutationFn: (body) => ... }

// Used with TQ's hooks:
const { data } = useQuery(userQuery)       // TQ's useQuery
const mutation = useMutation(createUser)    // TQ's useMutation
```

- Pure functions — no hooks, no state, no React imports.
- `@tanstack/react-query` is a type-only import in the adapter source.
- `queryFn` receives TQ's `{ signal }` context and forwards it to parcely.
- `validate` narrows TQ's `data` type via the same `ValidatorOutput<V>` conditional type from `@parcely/core`.

## Internals

### Dedup store (`dedup.ts`)

A `Map<string, Promise<HttpResponse<unknown>>>` keyed by the serialized query key.

1. Compute key from `['parcely', method, url, JSON.stringify(sortedParams)]`.
2. If key exists in the map → return the existing promise.
3. If not → call client method, store the promise, delete on settle (resolve or reject).
4. No TTL, no cache — settle = gone.

~30 lines. The upgrade path for caching is TanStack Query.

### Key derivation (`keys.ts`)

`deriveKey(method: string, url: string, params?: Record<string, unknown>): string`

- Sorts param keys for stability (`{ b: 1, a: 2 }` and `{ a: 2, b: 1 }` produce the same key).
- `undefined` / missing params treated as `{}`.
- Returns a JSON string: `'["parcely","GET","/users/me","{\\"include\\":\\"org\\"}"]'`.

### useQuery state machine

Three states via `useReducer`:

```
idle → loading → success | error
         ↑         |        |
         └─────────┴────────┘  (refetch)
```

- Mount triggers `loading` → fires `fetchOrDedup()`.
- Resolve → `success` with `data: T`.
- Reject → `error` with `error: HttpError`.
- `refetch()` → back to `loading`, bypasses dedup (new AbortController, new fetch).
- Unmount → abort via cleanup function. Settle handler checks a `cancelled` ref and skips state updates.

### useSuspenseQuery

Shares the `fetchOrDedup()` function. Difference: instead of returning `isLoading: true`, it throws the promise. React Suspense catches the thrown promise, renders the fallback, and re-renders on settle.

On error: throws the `HttpError` directly (caught by `<ErrorBoundary>`).

### useMutation state machine

```
idle → pending → success | error
                    |        |
                    └────────┘  (reset → idle)
```

No dedup. No abort-on-unmount. `mutate(body)` triggers `pending`, calls `client.request(...)`, settles to `success` or `error`. `reset()` returns to `idle`.

### TanStack Query adapter

`queryOptions` and `mutationOptions` are pure factory functions:

- `queryOptions(client, url, opts?)` → `{ queryKey, queryFn }`
  - `queryFn: ({ signal }) => client.get(url, { ...opts, signal }).then(r => r.data)`
  - Returns `.data` directly (TQ convention — TQ wraps its own metadata around it).
- `mutationOptions(client, method, url, opts?)` → `{ mutationKey, mutationFn }`
  - `mutationFn: (body) => client.request({ method, url, body, ...opts }).then(r => r.data)`

## Package structure

```
packages/react/
  src/
    context.tsx              — ParcelyProvider + useParcelyClient
    keys.ts                  — deriveKey()
    dedup.ts                 — in-flight promise store
    use-query.ts             — useQuery hook
    use-suspense-query.ts    — useSuspenseQuery hook
    use-mutation.ts          — useMutation hook
    types.ts                 — QueryOptions, MutationOptions, QueryResult, etc.
    index.ts                 — barrel: hooks + provider + types
    tanstack/
      query-options.ts       — queryOptions() adapter
      mutation-options.ts    — mutationOptions() adapter
      index.ts               — barrel for /tanstack sub-entry
    *.test.ts / *.test.tsx   — colocated
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  LICENSE
```

### package.json

```json
{
  "name": "@parcely/react",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./tanstack": { "types": "./dist/tanstack/index.d.ts", "import": "./dist/tanstack/index.js" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "peerDependencies": {
    "@parcely/core": "workspace:*",
    "react": ">=18"
  },
  "peerDependenciesMeta": {
    "@tanstack/react-query": { "optional": true }
  },
  "devDependencies": {
    "@parcely/core": "workspace:*",
    "@tanstack/react-query": "^5",
    "@testing-library/react": "^16",
    "react": "^19",
    "react-dom": "^19",
    "rimraf": "^6",
    "typescript": "^6",
    "vitest": "^3"
  }
}
```

Zero runtime dependencies. React + @parcely/core as peer deps. TanStack Query optional.

## Tests

vitest + @testing-library/react (`renderHook`).

| File | Coverage |
|---|---|
| `keys.test.ts` | Stable serialization, param key ordering, undefined handling, different URLs produce different keys |
| `dedup.test.ts` | Concurrent calls share promise, settle clears entry, error settle clears too, different keys don't dedup |
| `use-query.test.ts` | Happy path (data + isSuccess), error state (HttpError + isError), refetch forces fresh request, abort on unmount, dedup across concurrent renders, validate narrows type, client-from-options overrides provider |
| `use-suspense-query.test.tsx` | Throws promise during loading (Suspense catches), resolves on success (data non-null), throws HttpError on error (ErrorBoundary catches) |
| `use-mutation.test.ts` | mutate fires request + isPending, error state, mutateAsync returns promise, reset clears to idle, does NOT abort on unmount, validate narrows type |
| `context.test.tsx` | Provider passes client, useParcelyClient throws without provider, hook with explicit client option skips provider |
| `tanstack/query-options.test.ts` | Correct queryKey shape, queryFn calls client.get with signal, validate type flows through |
| `tanstack/mutation-options.test.ts` | Correct mutationKey, mutationFn calls client.request with body |

Mock strategy: mock `Client` interface with vi.fn() returning canned `HttpResponse` objects. No real fetch, no DOM rendering needed for non-Suspense tests.

## Verification

1. `pnpm --filter @parcely/react test` — all tests green.
2. `pnpm --filter @parcely/react build` — `dist/` contains both `index.js` and `tanstack/index.js`.
3. `pnpm typecheck` — clean across workspace.
4. Type-level test: `queryOptions(http, '/u', { validate: UserSchema })` produces correctly-typed `queryKey` + `queryFn` that TQ's `useQuery` accepts.

## Out of scope

- Caching, staleTime, gcTime, background refetch, window-focus refetch — use TanStack Query.
- SSR hydration / streaming — use TanStack Query's SSR support.
- Infinite queries / pagination — use TanStack Query's `useInfiniteQuery` with `queryOptions`.
- SWR adapter — can be added later as `@parcely/react/swr` if demand warrants.
- React Native specific concerns — the hooks are runtime-agnostic; RN works if fetch does.
