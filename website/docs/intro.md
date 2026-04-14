---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Why parcely?

**parcely** is a fetch-based HTTP client for TypeScript and JavaScript. It gives you the ergonomic, batteries-included API you know from axios -- `createClient`, interceptors, typed responses, upload progress -- while fixing the security and architectural issues that have produced axios CVEs over the past several years.

## Design goals

- **Zero runtime dependencies.** Uses `globalThis.fetch` everywhere. On Node 20+, the built-in `undici` module is imported only when you explicitly set TLS overrides.
- **Secure by default.** 13 defense rows (SSRF, redirect header stripping, CRLF injection, prototype-pollution-safe merging, and more) are enabled out of the box. See the [Security defaults](/docs/security/threat-model) page.
- **Tree-shakeable.** Named exports only, `sideEffects: false`, conditional dynamic import for TLS. Ship only what you use.
- **Universal runtime.** Targets modern browsers, Node 20+, Bun, and Deno.
- **Validator extension point.** Opt-in runtime response validation via Standard Schema (Zod, Valibot, ArkType) or any `(input) => T` function. No validator runtime dependency.
- **Monorepo from day one.** Core stays small. Companion subpackages (`@parcely/auth-token`, `@parcely/auth-redirect`) handle common auth patterns; further slots (retry, react, upload-node) are reserved for the future.

## What it looks like

```ts
import { createClient } from '@parcely/core'

const http = createClient({
  baseURL: 'https://api.example.com',
  headers: { Accept: 'application/json' },
  timeout: 5000,
})

const { data, status, headers } = await http.get('/users/me')
```

## Coming from axios?

The API surface is intentionally familiar. The [Migration guide](/docs/migrating-from-axios) has tabbed side-by-side snippets for every common pattern and a full feature-mapping table.

## Next steps

- [Installation](/docs/installation)
- [Quick start](/docs/quick-start)
- [Migrating from axios](/docs/migrating-from-axios)
- [Guides](/docs/guides/baseurl-and-defaults)
- [API Reference](/docs/reference/create-client)
