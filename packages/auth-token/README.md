# @postalservice/auth-token

Bearer / API-key / Basic token interceptor for [`postalservice`](https://www.npmjs.com/package/postalservice). Supports single-flight refresh-on-401 coalescing with bounded retry.

```sh
npm install postalservice @postalservice/auth-token
```

```ts
import { createClient } from 'postalservice'
import { createAuthToken } from '@postalservice/auth-token'

const http = createClient({ baseURL: 'https://api.example.com' })

const auth = createAuthToken({
  scheme: 'Bearer',                               // 'Bearer' | 'Basic' | 'Token' | any string
  header: 'Authorization',                        // default
  getToken: async () => localStorage.getItem('access_token'),
  refreshOn: [401],
  refresh: async () => {
    const r = await http.post<{ access: string }>('/auth/refresh')
    localStorage.setItem('access_token', r.data.access)
    return r.data.access
  },
})

auth.install(http)
```

## Behaviour

- **Request-side:** attaches `<header>: <scheme> <token>` when `getToken()` returns a non-null value. Respects an already-set header on the per-request config.
- **Response-side:** on an `HttpError` with `status` in `refreshOn`, calls `refresh()` through a single-flight wrapper so concurrent 401s share one refresh. Retries the original request **once** with the new token. If the retried request also fails, the second error propagates — no infinite loops.
- **Refresh-fails fall-through:** if `refresh()` itself rejects, the original error is rethrown.

## License

MIT
