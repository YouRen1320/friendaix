import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  minify: false,
  splitting: false,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __FRIENDAIX_VERSION__: JSON.stringify(packageJson.version),
  },
});
