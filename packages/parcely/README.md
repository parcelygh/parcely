# parcely

Zero-dependency, fetch-based HTTP client with axios-like ergonomics and a secure-by-default posture.

```sh
npm install parcely
# if you plan to use tls customization on Node:
npm install undici
```

```ts
import { createClient, HttpError } from 'parcely'

const http = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5_000,
  headers: { Accept: 'application/json' },
})

http.interceptors.request.use((cfg) => {
  cfg.headers = { ...cfg.headers, Authorization: `Bearer ${getToken()}` }
  return cfg
})

const { data, status, headers } = await http.get<User>('/users/me', {
  params: { include: 'org' },
})

try {
  await http.post<CreatedUser, NewUser>('/users', { name: 'Mickey' })
} catch (e) {
  if (e instanceof HttpError) {
    // e.code    — 'ERR_HTTP_STATUS' | 'ERR_NETWORK' | 'ERR_TIMEOUT' | …
    // e.status  — HTTP status when code === 'ERR_HTTP_STATUS'
    // e.config  — merged RequestConfig (sensitive headers redacted)
    // e.response — HttpResponse<unknown> when we got bytes back
  }
}
```

## Features

- **Zero runtime dependencies.** Global `fetch`. On Node, `undici` as an `optionalDependency` only for TLS customization.
- **Axios ergonomics.** `createClient`, method sugar, interceptors, envelope responses.
- **Tree-shakeable.** `sideEffects: false`, named exports, small modules — import only `HttpError` and you get ~0.4 kB.
- **Universal.** Browsers, Node 20+, Bun, Deno.
- **13 security defenses** baked in (SSRF via absolute-URL override, cross-origin redirect header stripping, prototype-pollution-safe merging, CRLF injection, content-type-aware JSON parsing, timeout+abort cleanup, sensitive-header redaction, and more).
- **Runtime validation extension point.** Pass any Standard-Schema validator (Zod, Valibot, ArkType, Effect-Schema) or `(input) => T` function via `config.validate`.
- **File uploads & progress.** Auto-FormData conversion from plain objects, upload/download progress callbacks, Node `fs.ReadStream` pass-through.

## Documentation

See the docs site for the migration-from-axios guide, the full how-to catalogue, the axios CVE index, and the complete API reference.

## License

MIT
