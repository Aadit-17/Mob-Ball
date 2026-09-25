import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: { main: 'index.html', changelog: 'changelog.html' } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
