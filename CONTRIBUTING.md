# Contributing to parcely

Thanks for your interest in improving parcely. This guide covers the common workflows.

## Prerequisites

- **Node.js 20 or 22** (LTS — CI runs both)
- **pnpm 10+** (see `packageManager` in `package.json`; corepack-enabled repos pick the right version automatically)
- A POSIX-like shell. Windows works via WSL.

```sh
git clone <your fork>
cd parcely
pnpm install
```

## Local development

One-shot verification (what CI runs):

```sh
pnpm typecheck
pnpm -r test
pnpm -r build
pnpm docs:build
pnpm check-docs-coverage
pnpm check-doc-snippets
pnpm check-treeshake
```

Optional end-to-end smoke (hits `httpbin.org` + spins up a local self-signed HTTPS server):

```sh
pnpm smoke
```

### Package layout

- `packages/parcely` — the core HTTP client. No runtime dependencies.
- `packages/auth-token` — `@parcely/auth-token` token interceptor with single-flight refresh.
- `packages/auth-redirect` — `@parcely/auth-redirect` browser redirect-on-401/403 interceptor.
- `website/` — Docusaurus documentation site.
- `scripts/` — CI scripts: docs-coverage, snippet type-check, tree-shake audit, smoke test.

### Running individual packages

```sh
pnpm --filter parcely test
pnpm --filter parcely test -- --watch   # watch mode
pnpm --filter @parcely/auth-token build
```

## Making a change

1. **Open an issue first** for anything non-trivial. Small bug fixes and typos can go straight to a PR.
2. Create a feature branch. Base on `main`.
3. Write tests. We aim for colocated `*.test.ts` per module in the core, plus a `security.test.ts` regression suite mapped to the 13-row security-defenses table in the plan. **New security-sensitive behaviour must have a named test in `security.test.ts`.**
4. Run the full CI sequence above. All gates must be green, including tree-shake and docs coverage.
5. **Add a changeset** describing your change — see "Versioning" below.
6. Open a PR against `main`. CI runs on every PR.

### Commit messages

We don't enforce a strict format. Conventional-ish is nice but not required. A good commit message explains *why* the change is being made, not just *what* changed.

### Code style

- **TypeScript strict mode** (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). The existing `tsconfig.base.json` is the source of truth.
- **No runtime dependencies in core** — `packages/parcely` must stay zero-dep at runtime (undici is an `optionalDependency` for TLS only).
- **Functional over class-based** everywhere except `HttpError`. No inheritance.
- **Named exports only.** No default exports. `"sideEffects": false` must remain true.
- **Small, focused modules.** If a file grows past ~300 lines, split it.

## Versioning and releases

parcely uses [Changesets](https://github.com/changesets/changesets) for version management. Every user-visible change needs a changeset.

```sh
pnpm changeset
```

Pick the affected package(s) and bump type (`patch`, `minor`, `major`). Write a short description — this becomes the CHANGELOG entry. Commit the generated `.changeset/*.md` file with your PR.

Maintainers merge PRs to `main`. The release workflow aggregates pending changesets into a "Version Packages" PR. Merging that PR publishes to npm.

## Security

If you discover a security vulnerability, please **do not** open a public issue. Email the maintainer directly or use GitHub's private security advisory feature. See `SECURITY.md` (TODO — file one if this repo doesn't have one yet) for response timelines.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to its terms.

## Licence

By contributing, you agree that your contributions will be licensed under the MIT License.
