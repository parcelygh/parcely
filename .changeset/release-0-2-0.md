---
"parcely": minor
---

0.2.0 — fix-it release addressing the v1 code review findings.

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
