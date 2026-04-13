/**
 * Tree-shake audit. A consumer that imports ONLY HttpError from parcely
 * must not pull in request.ts, tls.ts, validate.ts, body.ts, progress.ts,
 * client.ts, interceptors.ts, or redact.ts.
 *
 * Strategy:
 *  1. Write a tiny consumer entry that imports { HttpError } only.
 *  2. Bundle it with esbuild against the built parcely dist.
 *  3. Inspect the bundle metafile for forbidden module names.
 *  4. Sanity-check that HttpError itself IS in the bundle.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const tmpDir = join(repoRoot, '.treeshake-check')

const FORBIDDEN = new Set([
  'request.js',
  'tls.js',
  'validate.js',
  'body.js',
  'progress.js',
  'client.js',
  'interceptors.js',
  'redact.js',
  'url.js',
  'headers.js',
  'config.js',
])

async function run(): Promise<void> {
mkdirSync(tmpDir, { recursive: true })

const entryPath = join(tmpDir, 'entry.ts')
writeFileSync(
  entryPath,
  [
    `import { HttpError } from 'parcely'`,
    `export function touch(): HttpError {`,
    `  return new HttpError('x', { code: 'ERR_NETWORK', config: {} as never })`,
    `}`,
    '',
  ].join('\n'),
)

const outfile = join(tmpDir, 'bundle.js')

const result = await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  outfile,
  minify: true,
  treeShaking: true,
  metafile: true,
  absWorkingDir: repoRoot,
  nodePaths: [join(repoRoot, 'node_modules')],
  alias: {
    parcely: join(repoRoot, 'packages/parcely/dist/index.js'),
  },
  write: true,
  logLevel: 'warning',
})

const bundleSrc = readFileSync(outfile, 'utf8')

// Sanity: HttpError must be present.
if (!/HttpError/.test(bundleSrc)) {
  console.error('FAIL: bundle does not contain HttpError — bundling went wrong.')
  process.exit(1)
}

// Inspect the OUTPUT bundle — metafile.inputs lists every file esbuild read,
// but tree-shaking happens at output time. Look at outputs[bundle].inputs
// which carries bytesInOutput per source file.
const outputInfo = result.metafile!.outputs[outfile.replace(repoRoot + '/', '')]
  ?? Object.values(result.metafile!.outputs)[0]

console.log(`Bundle size: ${(bundleSrc.length / 1024).toFixed(2)} kB`)
console.log(`Bytes-in-output per parcely module:`)
const hits: string[] = []
for (const [file, info] of Object.entries(outputInfo.inputs)) {
  if (!file.includes('packages/parcely/dist/')) continue
  const base = file.slice(file.lastIndexOf('/') + 1)
  const bytes = info.bytesInOutput
  console.log(`  ${bytes.toString().padStart(5)} bytes  ${base}`)
  // A forbidden module contributing > 16 bytes indicates real code made it in.
  if (FORBIDDEN.has(base) && bytes > 16) hits.push(`${base} (${bytes} bytes)`)
}

if (hits.length > 0) {
  console.error(`\nFAIL: forbidden modules contributed code to the bundle:`)
  for (const h of hits) console.error(`  - ${h}`)
  process.exit(1)
} else {
  console.log(`\nPASS: no forbidden module contributed code when importing only HttpError.`)
}

rmSync(tmpDir, { recursive: true, force: true })
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
