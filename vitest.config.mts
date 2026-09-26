import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only src/domain is tested. It is pure TypeScript, so it runs in plain
    // Node with no Metro, no transform pipeline and no mocks — which is the
    // whole reason the boundary exists. Component tests are deliberately out
    // of scope: see docs/decisions/NOT-IN-M1.md.
    environment: 'node',
    include: ['src/domain/**/*.test.ts'],
  },
});
