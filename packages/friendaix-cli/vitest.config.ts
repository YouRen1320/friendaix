import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'friendaix-core': fileURLToPath(
        new URL('../configurator-core/src/index.ts', import.meta.url),
      ),
    },
  },
});
