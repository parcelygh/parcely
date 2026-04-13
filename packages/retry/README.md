# @parcely/retry

Exponential-backoff retry interceptor for [`parcely`](https://www.npmjs.com/package/parcely). Supports full jitter, `Retry-After` header parsing (integer + HTTP-date), idempotent-methods-by-default safety, and AbortSignal-aware sleep.

```sh
npm install parcely @parcely/retry
```

```ts
import { createClient } from 'parcely'
import { createRetry } from '@parcely/retry'

const http = createClient({ baseURL: 'https://api.example.com' })

const retry = createRetry({
  count: 3,                    // up to 3 retries (4 total attempts)
  baseDelayMs: 300,            // exponential backoff base
  maxDelayMs: 30_000,         // cap any single delay
  retryAfter: true,            // honour Retry-After header
  onRetry: ({ attempt, error, delayMs }) => {
    console.log(`Retry #${attempt} after ${delayMs}ms`, error)
  },
})

retry.install(http)
```

## Behaviour

- **Idempotent-only by default:** only `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE` are retried. POST and PATCH require explicit opt-in via `methods`.
- **Exponential backoff with full jitter:** delay = random in `[0, min(baseDelayMs * 2^attempt, maxDelayMs)]`.
- **Retry-After support:** honours both integer (seconds) and HTTP-date forms on 429/503. Clamped to `maxDelayMs`.
- **AbortSignal-aware:** if the request's `signal` is aborted during backoff sleep, the retry is cancelled and the abort propagates.
- **Coexists with `@parcely/auth-token`:** auth-token's single retry (`_retry: true`) is not counted against the retry budget.

## License

MIT
