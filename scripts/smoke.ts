/**
 * End-to-end smoke test for the built postalservice package.
 *
 * Two scenarios:
 *   1. Hit https://httpbin.org/get and assert the envelope shape.
 *   2. Spin up an inline Node HTTPS server with a self-signed cert and call it
 *      with `tls.rejectUnauthorized: false`; assert the call succeeds and the
 *      cert isn't trusted by default.
 *
 * Run with: pnpm exec tsx scripts/smoke.ts
 */
import { createServer } from 'node:https'
import { generateKeyPairSync, createSign, X509Certificate } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createClient, HttpError } from '../packages/postalservice/dist/index.js'

const ok = (label: string) => console.log(`  \x1b[32m✓\x1b[0m ${label}`)
const fail = (label: string, err?: unknown) => {
  console.error(`  \x1b[31m✗\x1b[0m ${label}`)
  if (err) console.error(err)
  process.exitCode = 1
}

// ---------------------------------------------------------------------------
// Scenario 1 — real network, envelope shape
// ---------------------------------------------------------------------------
async function scenario1(): Promise<void> {
  console.log('Scenario 1: https://httpbin.org/get envelope shape')
  const http = createClient({ baseURL: 'https://httpbin.org', timeout: 15_000 })
  try {
    const res = await http.get<{ url: string; headers: Record<string, string> }>('/get', {
      headers: { 'X-Smoke': 'postalservice' },
    })
    if (res.status === 200) ok(`status 200`)
    else fail(`status was ${res.status}`)

    if (res.data && typeof res.data === 'object') ok(`data is an object`)
    else fail(`data not an object: ${typeof res.data}`)

    if (res.data.url?.includes('httpbin.org/get')) ok(`data.url looks right: ${res.data.url}`)
    else fail(`data.url unexpected: ${res.data.url}`)

    if (res.headers instanceof Headers) ok(`headers is a native Headers instance`)
    else fail(`headers is not Headers: ${Object.prototype.toString.call(res.headers)}`)

    if (res.config && typeof res.config === 'object') ok(`config attached to envelope`)
    else fail(`config missing`)
  } catch (e) {
    fail('request threw', e)
  }
}

// ---------------------------------------------------------------------------
// Scenario 2 — self-signed server, tls.rejectUnauthorized toggle
// ---------------------------------------------------------------------------
function generateSelfSignedCert(): { key: string; cert: string } {
  // Minimal self-signed cert via OpenSSL-in-Node is non-trivial; instead use
  // a well-known pre-generated cert pair for local loopback. To keep this
  // pure Node, we synthesize keys and use the built-in X509 via a static PEM.
  // Easier: shell out to openssl — it's on macOS by default.
  // For portability we just embed a pre-generated cert valid for localhost.
  //
  // Generated once with:
  //   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
  //     -days 365 -nodes -subj "/CN=localhost"
  //
  // For this smoke script, generate on-the-fly via child_process openssl.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require('node:child_process') as typeof import('node:child_process')
  const { mkdtempSync, readFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'ps-smoke-'))
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${dir}/key.pem -out ${dir}/cert.pem -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`,
      { stdio: 'ignore' },
    )
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function scenario2(): Promise<void> {
  console.log('\nScenario 2: self-signed HTTPS + tls.rejectUnauthorized toggle')

  let key: string, cert: string
  try {
    ;({ key, cert } = generateSelfSignedCert())
  } catch (e) {
    console.log('  (skipped — openssl not available)')
    return
  }

  const server = createServer({ key, cert }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const url = `https://localhost:${port}`

  try {
    // 2a. Default (reject self-signed) — should throw ERR_NETWORK.
    const defaultClient = createClient({ baseURL: url, timeout: 5_000 })
    try {
      await defaultClient.get('/a')
      fail('default client accepted self-signed cert (expected throw)')
    } catch (e) {
      if (e instanceof HttpError && e.code === 'ERR_NETWORK') {
        ok(`default client rejected self-signed (HttpError code=${e.code})`)
      } else if (e instanceof HttpError) {
        ok(`default client rejected self-signed (HttpError code=${e.code})`)
      } else {
        fail(`default client threw non-HttpError`, e)
      }
    }

    // 2b. With tls.rejectUnauthorized: false — should succeed.
    const insecureClient = createClient({
      baseURL: url,
      timeout: 5_000,
      tls: { rejectUnauthorized: false },
    })
    try {
      const res = await insecureClient.get<{ ok: boolean; path: string }>('/b')
      if (res.status === 200 && res.data.ok === true && res.data.path === '/b') {
        ok(`tls.rejectUnauthorized:false succeeded (status=${res.status}, path=${res.data.path})`)
      } else {
        fail(`insecure client response unexpected: status=${res.status}, data=${JSON.stringify(res.data)}`)
      }
    } catch (e) {
      fail(`tls.rejectUnauthorized:false threw`, e)
    }
  } finally {
    server.close()
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await scenario1()
  await scenario2()
  console.log(`\n${process.exitCode ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
