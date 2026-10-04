/// <reference types="vitest/config" />

import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  base: '/specialtictactoe/',
  plugins: [preact()],
  build: {
    // three.js alone is ~500 kB minified; raise the limit to avoid a permanent warning.
    chunkSizeWarningLimit: 1024,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/geometry/**', 'src/engine/**'],
    },
  },
});
