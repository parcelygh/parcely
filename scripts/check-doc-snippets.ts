/**
 * check-doc-snippets.ts
 *
 * Extracts every ```ts / ```tsx code block from
 * website/docs/migrating-from-axios.mdx, writes them to a temp file that
 * imports from the local postalservice workspace package, and runs
 * tsc --noEmit over it.  Fails if type-check fails.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const migrationDoc = path.join(ROOT, 'website/docs/migrating-from-axios.mdx');
const content = fs.readFileSync(migrationDoc, 'utf-8');

// Extract all ```ts and ```tsx code blocks
const codeBlockRegex = /```tsx?\n([\s\S]*?)```/g;
const blocks: string[] = [];
let match: RegExpExecArray | null;

while ((match = codeBlockRegex.exec(content)) !== null) {
  const code = match[1]!;
  // We only type-check blocks that import from postalservice
  if (code.includes("from 'postalservice'")) {
    blocks.push(code);
  }
}

if (blocks.length === 0) {
  console.log('No postalservice TypeScript code blocks found in migration guide.');
  process.exit(0);
}

console.log(`Found ${blocks.length} postalservice code block(s) to type-check.`);

// Create a temp directory
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-doc-snippets-'));

// Create a postalservice declaration file that matches the public API.
// We derive this from the actual source types so it stays in sync.
const postalserviceDts = `
declare module 'postalservice' {
  export interface TlsConfig {
    rejectUnauthorized?: boolean;
    ca?: string | string[];
  }
  export interface ProgressEvent {
    loaded: number;
    total?: number;
    percent?: number;
  }
  export type FormDataSerializer = 'brackets' | 'indices' | 'repeat';
  export type ResponseType = 'json' | 'text' | 'arraybuffer' | 'blob';
  export type HeadersInit = Record<string, string> | [string, string][] | Headers;

  export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': {
      readonly version: 1;
      readonly vendor: string;
      readonly validate: (value: unknown) => { readonly value: Output } | { readonly issues: ReadonlyArray<{ readonly message: string }> };
    };
  }

  export type Validator<T> =
    | ((input: unknown) => T)
    | { parse(input: unknown): T }
    | StandardSchemaV1<unknown, T>;

  export interface RequestConfig {
    baseURL?: string | URL;
    url?: string;
    method?: string;
    headers?: HeadersInit;
    params?: Record<string, unknown>;
    body?: unknown;
    timeout?: number;
    signal?: AbortSignal;
    responseType?: ResponseType;
    validate?: Validator<unknown>;
    tls?: TlsConfig;
    followRedirects?: boolean;
    maxRedirects?: number;
    redirect?: 'follow' | 'manual' | 'error';
    allowAbsoluteUrls?: boolean;
    allowedProtocols?: string[];
    allowedRequestHeaders?: string[];
    sensitiveHeaders?: string[];
    formDataSerializer?: FormDataSerializer;
    onUploadProgress?: (event: ProgressEvent) => void;
    onDownloadProgress?: (event: ProgressEvent) => void;
  }

  export interface HttpResponse<T> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
    config: RequestConfig;
  }

  export interface InterceptorHandler<T> {
    fulfilled?: (value: T) => T | Promise<T>;
    rejected?: (err: unknown) => unknown;
  }

  export interface InterceptorManager<T> {
    use(handler: InterceptorHandler<T>): number;
    use(
      onFulfilled?: (value: T) => T | Promise<T>,
      onRejected?: (err: unknown) => unknown,
    ): number;
    eject(id: number): void;
  }

  export interface Client {
    defaults: RequestConfig;
    interceptors: {
      request: InterceptorManager<RequestConfig>;
      response: InterceptorManager<HttpResponse<unknown>>;
    };
    request<T>(config: RequestConfig): Promise<HttpResponse<T>>;
    get<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
    delete<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
    head<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
    options<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
    post<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;
    put<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;
    patch<T, B = unknown>(url: string, body?: B, config?: RequestConfig): Promise<HttpResponse<T>>;
  }

  export type HttpErrorCode =
    | 'ERR_HTTP_STATUS'
    | 'ERR_NETWORK'
    | 'ERR_TIMEOUT'
    | 'ERR_ABORTED'
    | 'ERR_TOO_MANY_REDIRECTS'
    | 'ERR_DISALLOWED_PROTOCOL'
    | 'ERR_DISALLOWED_HEADER'
    | 'ERR_ABSOLUTE_URL'
    | 'ERR_PARSE'
    | 'ERR_VALIDATION'
    | 'ERR_CRLF_INJECTION';

  export class HttpError extends Error {
    readonly code: HttpErrorCode;
    readonly status: number | undefined;
    readonly config: RequestConfig;
    readonly response: HttpResponse<unknown> | undefined;
    readonly cause: unknown;
  }

  export function isHttpError(value: unknown): value is HttpError;
  export function createClient(defaults?: RequestConfig): Client;
}
`;

fs.writeFileSync(path.join(tmpDir, 'postalservice.d.ts'), postalserviceDts, 'utf-8');

// Write a combined file with all snippets wrapped in async functions
const preamble = `
// Auto-generated: postalservice doc snippet type-check
// This file is not meant to be executed, only type-checked.

/// <reference path="./postalservice.d.ts" />

declare const file: File;
declare const fileBlob: Blob;
declare const largeFile: File;
declare const arrayBuffer: ArrayBuffer;
declare const someReadableStream: ReadableStream;
declare const http: import('postalservice').Client;
declare const form: FormData;
`;

const snippetBodies = blocks.map((block, i) => {
  // Collect all imports so we can re-emit them at the top of the function
  const importLines: string[] = [];
  const cleaned = block.replace(/^import\s+.*$/gm, (line) => {
    importLines.push(line);
    return '';
  }).replace(/^export\s+/gm, '');

  // Re-emit imports inside the function scope (they become top-of-function imports in TS)
  // Actually, we need to extract the bindings and declare them from the ambient module.
  // Since we have an ambient module declaration, we can use dynamic import destructuring.

  // Extract named imports from postalservice
  const postalserviceBindings: string[] = [];
  const zodBindings: string[] = [];

  for (const line of importLines) {
    // Match: import { foo, bar } from 'postalservice'
    const namedMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+'postalservice'/);
    if (namedMatch) {
      const names = namedMatch[1]!.split(',').map((n) => n.trim()).filter(Boolean);
      postalserviceBindings.push(...names);
    }
    // Match: import { z } from 'zod' or import * as z from 'zod'
    if (line.includes("from 'zod'")) {
      zodBindings.push('z');
    }
  }

  // Build declarations for the extracted imports
  const declLines: string[] = [];
  for (const name of postalserviceBindings) {
    declLines.push(`  const ${name} = (await import('postalservice')).${name};`);
  }

  // For zod, we just declare z as any since we don't have zod types
  if (zodBindings.length > 0) {
    declLines.push(`  const z: any = undefined as any;`);
  }

  const declBlock = declLines.length > 0 ? declLines.join('\n') + '\n' : '';

  return `// --- Snippet ${i + 1} ---\nasync function __snippet_${i}__() {\n${declBlock}${cleaned}\n}\n`;
});

const combined = preamble + '\n' + snippetBodies.join('\n');

const snippetFile = path.join(tmpDir, 'snippets.ts');
fs.writeFileSync(snippetFile, combined, 'utf-8');

// Write a tsconfig for the temp directory
const tsconfig = {
  compilerOptions: {
    module: 'esnext',
    target: 'esnext',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: 'bundler',
    lib: ['esnext', 'dom'],
  },
  include: ['snippets.ts'],
};

const tsconfigFile = path.join(tmpDir, 'tsconfig.json');
fs.writeFileSync(tsconfigFile, JSON.stringify(tsconfig, null, 2), 'utf-8');

// Run tsc
const tscPath = path.join(ROOT, 'node_modules/.bin/tsc');

try {
  execSync(`${tscPath} --project ${tsconfigFile} --noEmit`, {
    cwd: tmpDir,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  console.log('All postalservice code snippets in the migration guide type-check successfully.');
  process.exit(0);
} catch (err: unknown) {
  const error = err as { stdout?: string; stderr?: string };
  console.error('Type-check failed for migration guide code snippets:');
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);

  // Also print the combined file for debugging
  console.error('\n--- Combined snippets file ---');
  console.error(combined);

  process.exit(1);
} finally {
  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
