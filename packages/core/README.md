# @td2d/core

The td2d generation engine behind the [`td2d` command](https://www.npmjs.com/package/@td2d/cli): project loading, model building, rigs and animation, rendering, pixel processing, sprite sheets, validation, export, caching and batches.

Most people want `@td2d/cli`. Use this package to drive generation from your own Node.js code, or to write asset definitions as TypeScript with the SDK (`@td2d/core/sdk`, run by `td2d asset emit`).

```ts
import { loadProject, runBatch } from '@td2d/core';

const result = await runBatch({ project: loadProject(process.cwd()), match: 'props/*' });
if (result.error) throw result.error;
console.log(result.report.status);
```

Rendering uses three.js in the Playwright headless Chromium shell with the SwiftShader software rasteriser, so output is the same on every machine. `gl` is an optional peer dependency for the alternative headless-gl backend.

Requires Node.js 24 or newer. MIT licensed.
