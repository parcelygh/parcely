---
"parcely": minor
---

0.2.0 — fix-it release addressing the v1 code review findings, plus `@parcely/retry` as the first deferred addon.

Note on cascaded version bumps: because addons declare `parcely` as a `peerDependency` with a 0.x range, Changesets treats any `parcely` minor bump as breaking for them and escalates their versions. See the per-package notes below — `@parcely/retry` is a brand-new package and publishes at 0.1.0, while the two existing addons get cascaded majors for compatibility signaling.

### parcely

**Fixed**
- `FormData` brackets serializer now emits `field[]` (axios-compatible) instead of `field[0]` which duplicated `indices` mode.
- `validate` on request config now narrows the response generic `T` — calls like `http.get('/u', { validate: UserSchema })` produce `HttpResponse<User>` without explicit `<T>`. New `ValidatorOutput<V>` conditional helper powers the overloads.
- Redirect loop now re-validates `allowedProtocols` on each redirect target — a 302 to `file:///etc/passwd` is now rejected pre-flight with `ERR_DISALLOWED_PROTOCOL`.
- 307/308 redirects re-prepare the request body from `config.body`, so one-shot streams (FormData) aren't sent exhausted on the second hop.
- `tls.ts` replaced the `Function('return import...')()` eval with a variable-trick dynamic import — no `unsafe-eval` CSP, no security-scanner trips, same bundler opacity.
- `auth-token` request interceptor now skips when `_retry: true` to avoid clobbering a freshly refreshed token with a stale `getToken()` read.

**Added**
- `responseType: 'stream'` — returns the un-consumed `ReadableStream | null` as `data`. Validation is silently skipped for this mode.
- `HttpError.toJSON()` — safe JSON serialization. Flattens `Headers` to `Record<string, string>`, reduces `cause` to `{ name, message, code }` (no circular-reference throws), includes stack.
- Public `ValidatorOutput<V>` type export.
- Public `HttpErrorJSON` type export.

**Docs**
- ESM-only posture documented in README + installation guide with CJS migration recipes.
- `ValidatorOutput` documented in the validator reference with resolution-order rationale.
- "Differences from axios" section added to the migration guide flagging ESM-only, retry addon, no paramsSerializer, no XHR fallback, upload-progress browser matrix, error-shape table, and cookie-jar note.

### @parcely/auth-token

- Request interceptor skips when `_retry: true` is set on the config. Prevents stale `getToken()` reads from clobbering a freshly refreshed token in the retry header.

### @parcely/auth-redirect

- No code changes in this release.

### @parcely/retry (new package)

First release. `createRetry(opts)` returns an interceptor pair with an `install(client)` convenience, following the same pattern as the other addons.

**Features**
- Exponential backoff with full jitter (Amazon-style decorrelation).
- Configurable `count` (default 3), `baseDelayMs` (300ms), `maxDelayMs` (30s cap).
- Idempotent methods only by default (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`). Opt in POST/PATCH explicitly via the `methods` option.
- Default `retryOn` predicate: `ERR_NETWORK`, `ERR_TIMEOUT`, and `ERR_HTTP_STATUS` with status in `[408, 429, 500, 502, 503, 504]`.
- `Retry-After` header honored (integer seconds and HTTP-date), clamped at `maxDelayMs`.
- `AbortSignal`-aware backoff sleep — aborting during a delay cancels the pending retry.
- `onRetry` hook with `{ attempt, error, delayMs }` context. Throwing from the hook aborts the retry loop.
- `_retryCount` marker on retry configs. Coexists cleanly with `@parcely/auth-token`'s `_retry` marker — the two don't double-count each other.
- 33 colocated tests (15 for the backoff/parsing helpers, 18 for end-to-end behaviour).
