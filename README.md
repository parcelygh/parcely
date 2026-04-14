# parcely

A zero-dependency, fetch-based HTTP client with axios-like ergonomics and a secure-by-default posture.

```ts
import { createClient, HttpError } from '@parcely/core'

const http = createClient({ baseURL: 'https://api.example.com', timeout: 5_000 })

const { data, status } = await http.get<User>('/users/me')

try {
  await http.post('/users', { name: 'Mickey' })
} catch (e) {
  if (e instanceof HttpError && e.status === 409) { /* … */ }
}
```

## Why

- **Zero runtime dependencies.** Built on global `fetch`. Undici pulls in only when TLS overrides are used, as an `optionalDependency`.
- **Tree-shakeable.** Named exports, `sideEffects: false`, small focused modules. A consumer importing only `HttpError` ends up with ~0.4 kB of code.
- **Universal.** Modern browsers, Node 20+, Bun, Deno.
- **ESM-only.** Each package's `exports` map declares `"import"` only. CommonJS consumers can use dynamic `import()` or set `"type": "module"` in `package.json` — see [the installation guide](./website/docs/installation.mdx) for details.
- **Axios-like API.** `createClient`, method sugar (`get/post/put/patch/delete`), `interceptors.{request,response}`, envelope responses `{ data, status, headers, config }`.
- **Secure-by-default.** 13 baked-in defenses against the classes of bugs that have produced axios CVEs — SSRF via absolute-URL override, cross-origin redirect header leakage, prototype-pollution-safe merging, CRLF header injection, content-type-aware JSON parsing, and more.
- **Runtime validation extension point.** Pass any Standard-Schema validator (Zod, Valibot, ArkType, Effect-Schema) or a plain `(input) => T` function.

## Packages in this repo

| Package | Description |
|---|---|
| [`@parcely/core`](./packages/parcely) | Core HTTP client. |
| [`@parcely/auth-token`](./packages/auth-token) | Bearer / API-key / Basic token interceptor with single-flight refresh-on-401. |
| [`@parcely/auth-redirect`](./packages/auth-redirect) | Browser 401/403 → login redirect interceptor with `return_to` preservation and cooldown debounce. |
| [`@parcely/retry`](./packages/retry) | Exponential-backoff retries with full jitter, `Retry-After` honoring, and AbortSignal-aware backoff. |
| [`@parcely/react`](./packages/react) | React hooks (`useQuery`, `useSuspenseQuery`, `useMutation`) + TanStack Query adapter. |
| [`website`](./website) | Documentation site at [parcely.cc](https://parcely.cc). |

Reserved for future development: `@parcely/upload-node`.

## Documentation

The full docs live in [`website/`](./website). The flagship is the **Migrating from axios** guide — side-by-side tabbed snippets for every common pattern plus a full feature-mapping table.

Run the docs locally:

```sh
pnpm docs:dev
```

## Development

```sh
# install all workspaces
pnpm install

# run everything CI runs
pnpm typecheck
pnpm -r test
pnpm -r build
pnpm docs:build
pnpm check-docs-coverage
pnpm check-doc-snippets
pnpm check-treeshake
```

### Smoke test (hits network)

```sh
pnpm smoke
```

Hits `https://httpbin.org/get` and spins up a local self-signed HTTPS server to exercise the `tls.rejectUnauthorized: false` path.

### Layout

- `packages/parcely` — core library
- `packages/auth-token` — `@parcely/auth-token`
- `packages/auth-redirect` — `@parcely/auth-redirect`
- `website` — Docusaurus docs
- `scripts` — doc coverage, doc-snippet type-checker, tree-shake audit, smoke test

## Release process

Versioning and publishing are managed by [Changesets](https://github.com/changesets/changesets). To propose a version bump in a PR:

```sh
pnpm changeset
```

Describe the change; Changesets asks which packages are affected and the bump type. Commit the generated file. When the PR merges to `main`, the CI "Release" workflow opens a **Version Packages** PR aggregating all pending changesets. Merging that PR publishes to npm.

## License

MIT — see [LICENSE](./LICENSE).
