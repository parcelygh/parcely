# @postalservice/auth-redirect

Browser-side login-redirect interceptor for [`postalservice`](https://www.npmjs.com/package/postalservice). On `401` / `403`, redirects to a login URL — with optional `return_to` preservation, a `shouldRedirect` predicate, and cooldown debounce to prevent redirect storms.

```sh
npm install postalservice @postalservice/auth-redirect
```

```ts
import { createClient } from 'postalservice'
import { createAuthRedirect } from '@postalservice/auth-redirect'

const http = createClient({ baseURL: 'https://api.example.com' })

const redirect = createAuthRedirect({
  loginUrl: '/login',                             // string | (err) => string
  on: [401, 403],                                 // default
  preserveReturnTo: true,                         // appends ?return_to=<encoded current href>
  returnToParam: 'return_to',
  shouldRedirect: (err) => !err.config.url?.includes('/public/'),
  cooldownMs: 2_000,                              // debounce repeated redirects
})

redirect.install(http)
```

## Behaviour

- Triggers on an `HttpError` with `code === 'ERR_HTTP_STATUS'` and `status` in `on`.
- Appends `?<returnToParam>=<encodedCurrentHref>` when `preserveReturnTo`.
- `shouldRedirect(err)` returning `false` suppresses the redirect.
- Cooldown prevents a second redirect within `cooldownMs` of the first.
- **Non-browser runtime:** no-op with a one-shot `console.warn` — safe to install in isomorphic code.
- **Always rethrows** the original error after (or instead of) triggering a redirect.

## Ordering with `@postalservice/auth-token`

Install `auth-token` first and `auth-redirect` second. Refresh-on-401 gets first crack at the error; if refresh succeeds, the retried request typically resolves and the redirect never fires. If refresh fails or isn't configured, the redirect handles it.

## License

MIT
