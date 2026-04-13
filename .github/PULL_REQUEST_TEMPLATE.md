<!-- Thanks for the PR! The more of these boxes you can fill in, the faster the review. -->

## What this PR does

<!-- 1-3 sentences. If this fixes an issue, link it with `Closes #123`. -->

## Why

<!-- What problem was the user hitting? What changed in the code to address it? If this is a refactor, what motivated it now? -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (bumps a major version)
- [ ] Refactor / internal-only
- [ ] Documentation
- [ ] Tests or tooling only

## Checklist

- [ ] Tests pass (`pnpm -r test`)
- [ ] Typecheck clean (`pnpm typecheck`)
- [ ] Docs build clean (`pnpm docs:build`)
- [ ] Docs coverage clean (`pnpm check-docs-coverage`)
- [ ] Tree-shake audit still passes (`pnpm check-treeshake`)
- [ ] Added a changeset (`pnpm changeset`) if this touches a published package
- [ ] Added/updated tests for the behaviour changed
- [ ] If security-sensitive: added a named test in `packages/parcely/src/security.test.ts`

## Notes for reviewer

<!-- Anything that isn't obvious from the diff. Design decisions, trade-offs considered, follow-ups deliberately left out. -->
