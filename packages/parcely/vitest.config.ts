import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .test-d.ts files are typecheck-only — running them as regular tests
    // breaks because `expectTypeOf(value)` evaluates the value at runtime,
    // and the values in those files are `declare`d type-only stubs.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
  },
});
