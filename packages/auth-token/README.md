# @parcely/auth-token

Bearer / API-key / Basic token interceptor for [`parcely`](https://www.npmjs.com/package/parcely). Supports single-flight refresh-on-401 coalescing with bounded retry.

```sh
npm install @parcely/core @parcely/auth-token
```

```ts
import { createClient } from '@parcely/core'
import { createAuthToken } from '@parcely/auth-token'

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
