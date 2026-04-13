---
sidebar_position: 1
---

# Introduction

Welcome to the **postalservice** documentation.

postalservice is a fetch-based HTTP client for TypeScript and JavaScript with an Axios-like ergonomic API, zero runtime dependencies, and secure defaults.

## Quick start

```bash
npm install postalservice
```

```ts
import { createClient } from 'postalservice';

const http = createClient({
  baseURL: 'https://api.example.com',
});

const { data } = await http.get('/users/me');
```

More guides and API reference pages are coming soon.
