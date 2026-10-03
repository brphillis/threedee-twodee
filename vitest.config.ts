import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Workspace packages export their TypeScript sources under the "td2d-source"
// condition, so tests run against src/ without a build step.
const conditions = ['td2d-source', 'node', 'import', 'module', 'default'];

/** The same switches the render backend uses, so browser tests rasterise with SwiftShader too. */
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['packages/core/test/render/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'render',
          environment: 'node',
          include: ['packages/core/test/render/**/*.test.ts'],
          globalSetup: ['packages/core/test/render/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { conditions: ['td2d-source', 'browser', 'import', 'module', 'default'] },
        test: {
          name: 'harness',
          include: ['packages/render-harness/test-browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({ launchOptions: { args: SWIFTSHADER_ARGS } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        plugins: [react()],
        resolve: { conditions: ['td2d-source', 'browser', 'import', 'module', 'default'] },
        test: {
          name: 'viewer',
          include: ['apps/viewer/test-browser/**/*.test.tsx'],
          globalSetup: ['apps/viewer/test-browser/fixture.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({ launchOptions: { args: SWIFTSHADER_ARGS } }),
            instances: [{ browser: 'chromium', viewport: { width: 1280, height: 900 } }],
          },
        },
      },
      ...(process.env.TD2D_EXPERIMENTS === '1'
        ? [
            {
              extends: true as const,
              test: {
                name: 'experiments',
                environment: 'node' as const,
                include: ['packages/core/test/experiments/**/*.experiment.ts'],
                globalSetup: ['packages/core/test/render/global-setup.ts'],
                testTimeout: 600_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['packages/*/e2e/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
