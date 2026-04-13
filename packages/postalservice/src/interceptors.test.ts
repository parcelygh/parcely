import { describe, it, expect } from 'vitest';
import { createInterceptorChain } from './interceptors.js';

describe('createInterceptorChain', () => {
  it('runs handlers in insertion order', async () => {
    const chain = createInterceptorChain<number>();
    chain.use((v) => v + 1);
    chain.use((v) => v * 2);
    expect(await chain.run(5)).toBe(12); // (5+1)*2
  });

  it('supports async handlers', async () => {
    const chain = createInterceptorChain<number>();
    chain.use(async (v) => {
      return v + 10;
    });
    chain.use((v) => v * 3);
    expect(await chain.run(1)).toBe(33); // (1+10)*3
  });

  it('ejects a handler by id', async () => {
    const chain = createInterceptorChain<number>();
    const id = chain.use((v) => v + 100);
    chain.use((v) => v * 2);
    chain.eject(id);
    expect(await chain.run(5)).toBe(10); // 5*2 (no +100)
  });

  it('error-path short-circuits on fulfilled throw', async () => {
    const chain = createInterceptorChain<number>();
    chain.use(() => {
      throw new Error('boom');
    });
    chain.use(
      (v) => v + 1, // should not run
      (err) => {
        // recover
        return 42;
      },
    );
    expect(await chain.run(0)).toBe(42);
  });

  it('stays on error path if no rejected handler', async () => {
    const chain = createInterceptorChain<number>();
    chain.use(() => {
      throw new Error('boom');
    });
    chain.use((v) => v + 1); // no rejected handler
    await expect(chain.run(0)).rejects.toThrow('boom');
  });

  it('rejected handler can rethrow', async () => {
    const chain = createInterceptorChain<number>();
    chain.use(() => {
      throw new Error('original');
    });
    chain.use(undefined, () => {
      throw new Error('rethrown');
    });
    await expect(chain.run(0)).rejects.toThrow('rethrown');
  });

  it('passes through when no fulfilled handler', async () => {
    const chain = createInterceptorChain<number>();
    chain.use(undefined, () => 0); // no fulfilled handler
    expect(await chain.run(42)).toBe(42);
  });

  it('handles empty chain', async () => {
    const chain = createInterceptorChain<string>();
    expect(await chain.run('hello')).toBe('hello');
  });
});
