# @td2d/schema

The zod schemas, TypeScript types, error and warning codes, and JSON Schemas shared by every td2d package: asset definitions, presets, palettes, the project file, manifests, validation reports, generation records and batch reports.

```ts
import { AssetDefinition, jsonSchemaFor } from '@td2d/schema';

const parsed = AssetDefinition.safeParse(JSON.parse(text));
const schema = jsonSchemaFor('asset');
```

`@td2d/schema/camera` holds the camera maths that td2d and its render harness share.

Part of [td2d](https://www.npmjs.com/package/@td2d/cli). Requires Node.js 24 or newer. MIT licensed.
