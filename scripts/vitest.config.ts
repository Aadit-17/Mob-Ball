import { defineConfig } from 'vitest/config';

/** Separate config so the balance harness never runs with the unit tests. */
export default defineConfig({
  test: { environment: 'node', include: ['scripts/**/*.sim.ts'], testTimeout: 600_000 },
});
