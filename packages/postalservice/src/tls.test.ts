import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDispatcher, _resetTlsWarnings } from './tls.js';

// Since we're running in Node, we need to trick the browser detection.
// We'll do this by mocking globalThis.process for some tests.

describe('resolveDispatcher', () => {
  beforeEach(() => {
    _resetTlsWarnings();
  });

  it('returns undefined when tls is undefined', async () => {
    const result = await resolveDispatcher(undefined);
    expect(result).toBeUndefined();
  });

  it('returns undefined and warns in browser-like environment', async () => {
    // Save and delete process to simulate browser
    const origProcess = globalThis.process;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // @ts-expect-error: deleting process for browser simulation
      delete globalThis.process;
      _resetTlsWarnings();

      const result = await resolveDispatcher({ rejectUnauthorized: true });
      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        '[postalservice] TLS options are ignored in browser environments.',
      );
    } finally {
      globalThis.process = origProcess;
      warnSpy.mockRestore();
    }
  });

  it('browser warning is one-shot', async () => {
    const origProcess = globalThis.process;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // @ts-expect-error: deleting process for browser simulation
      delete globalThis.process;
      _resetTlsWarnings();

      await resolveDispatcher({ rejectUnauthorized: true });
      await resolveDispatcher({ rejectUnauthorized: true });
      // Should warn only once
      const browserWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('browser environments'),
      );
      expect(browserWarns).toHaveLength(1);
    } finally {
      globalThis.process = origProcess;
      warnSpy.mockRestore();
    }
  });

  it('emits one-shot warn when rejectUnauthorized is false in non-production', async () => {
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      _resetTlsWarnings();
      // This will attempt to import undici and may succeed or fail; we just check the warn
      await resolveDispatcher({ rejectUnauthorized: false }).catch(() => {});

      const insecureWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rejectUnauthorized'),
      );
      expect(insecureWarns).toHaveLength(1);
    } finally {
      if (origEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = origEnv;
      }
      warnSpy.mockRestore();
    }
  });

  it('does NOT warn about rejectUnauthorized in production', async () => {
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      _resetTlsWarnings();
      await resolveDispatcher({ rejectUnauthorized: false }).catch(() => {});

      const insecureWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('rejectUnauthorized'),
      );
      expect(insecureWarns).toHaveLength(0);
    } finally {
      if (origEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = origEnv;
      }
      warnSpy.mockRestore();
    }
  });
});
