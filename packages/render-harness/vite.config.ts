import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Builds one self-contained script that the render backend serves to the headless browser.
export default defineConfig({
  root: import.meta.dirname,
  define: { __HARNESS_VERSION__: JSON.stringify(pkg.version) },
  // Bundle workspace packages from source so the build never depends on their compiled output.
  resolve: { conditions: ['td2d-source', 'browser', 'import', 'module', 'default'] },
  build: {
    outDir: 'dist',
    // dist/lib holds the Node build from tsc; replace only the bundle.
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    target: 'es2022',
    lib: {
      entry: 'src/browser-entry.ts',
      formats: ['iife'],
      name: 'td2dHarness',
      fileName: () => 'td2d-harness.js',
    },
  },
});
