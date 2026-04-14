# @parcely/react

React hooks for [parcely](https://github.com/mickey-thomas/postalservice). Standalone hooks with built-in dedup and abort, plus a TanStack Query adapter.

## Install

```sh
pnpm add @parcely/react @parcely/core react
```

## Usage

### Standalone hooks

```tsx
import { ParcelyProvider, useQuery, useMutation } from '@parcely/react';
import { createClient } from '@parcely/core';

const http = createClient({ baseURL: 'https://api.example.com' });

function App() {
  return (
    <ParcelyProvider client={http}>
      <Users />
    </ParcelyProvider>
  );
}

function Users() {
  const { data, isLoading, error } = useQuery('/users');
  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

### TanStack Query adapter

```ts
import { queryOptions, mutationOptions } from '@parcely/react/tanstack';

const userQuery = queryOptions(http, '/users/me', { validate: UserSchema });
// Pass to TanStack Query's useQuery()
```

## License

MIT
