import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: `${import.meta.dirname}/src/client`,
  base: './',
  plugins: [react()],
  resolve: { conditions: ['td2d-source', 'browser', 'import', 'module', 'default'] },
  build: {
    outDir: `${import.meta.dirname}/dist/client`,
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsDir: '_td2d/app',
    manifest: true,
    // The lazy 3D tab carries three.js; the main bundle budget is checked by the viewer e2e test.
    chunkSizeWarningLimit: 800,
  },
});
