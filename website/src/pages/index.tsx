import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

const features: { title: string; description: string }[] = [
  {
    title: 'Security defaults',
    description:
      'SSRF protection, cross-origin header stripping, CRLF injection defense, prototype-pollution-safe merging, and 13 security defaults that prevent the class of CVEs found in axios.',
  },
  {
    title: 'Tree-shakeable',
    description:
      'Named exports only, sideEffects: false, conditional dynamic import for Node TLS. Ship only what you use.',
  },
  {
    title: 'Universal runtime',
    description:
      'Runs on Node 20+, Bun, Deno, and modern browsers. Uses globalThis.fetch everywhere with undici only for TLS overrides on Node.',
  },
  {
    title: 'Axios-portable',
    description:
      'createClient, interceptors, request/response envelope, .get/.post/.put/.patch/.delete/.head/.options -- migrate from axios in minutes.',
  },
  {
    title: 'Validator extension',
    description:
      'Opt-in runtime response validation via Standard Schema (Zod, Valibot, ArkType), .parse() objects, or plain functions. Zero validator runtime deps.',
  },
  {
    title: 'Upload and progress',
    description:
      'FormData, auto-conversion from plain objects with File/Blob values, binary body pass-through, upload and download progress events.',
  },
];

const demoCode = `import { createClient } from 'parcely'
import { z } from 'zod'

const http = createClient({
  baseURL: 'https://api.example.com',
  headers: { Accept: 'application/json' },
  timeout: 5000,
})

// Typed response with runtime validation
const User = z.object({ id: z.string(), name: z.string() })

const { data, status } = await http.get('/users/me', {
  validate: User,
})
// data is typed as { id: string; name: string }

// Post with auto-serialised JSON body
await http.post('/users', { name: 'Mickey' })

// Upload with progress
const form = new FormData()
form.set('avatar', file)
await http.post('/upload', form, {
  onUploadProgress: ({ percent }) => console.log(percent),
})`;

function HomepageHeader(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">Zero-dep fetch with axios ergonomics</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/quick-start">
            Quick Start
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/migrating-from-axios">
            Migrate from Axios
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeaturesSection(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {features.map((feat) => (
            <div key={feat.title} className={styles.featureCard}>
              <Heading as="h3">{feat.title}</Heading>
              <p>{feat.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoSection(): ReactNode {
  return (
    <section className={styles.codeDemo}>
      <div className="container">
        <Heading as="h2">Get started in 60 seconds</Heading>
        <CodeBlock language="ts" title="demo.ts">
          {demoCode}
        </CodeBlock>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Zero-dep fetch with axios ergonomics"
      description="parcely is a fetch-based HTTP client for TypeScript with an axios-like API, zero runtime dependencies, and secure defaults.">
      <HomepageHeader />
      <main>
        <FeaturesSection />
        <DemoSection />
      </main>
    </Layout>
  );
}
