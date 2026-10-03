/**
 * Regenerates committed files derived from the schema package:
 *   schemas/*.schema.json        JSON Schema for every document type
 *   docs/reference/errors.md     error and warning reference
 *   docs/reference/schemas.md    schema reference
 * Run with `pnpm generate`. Tests fail when the committed files are stale.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allJsonSchemas, renderErrorReference, renderSchemaReference, serializeJsonSchema } from '../src/index.ts';

const repo = join(import.meta.dirname, '..', '..', '..');
const schemasDir = join(repo, 'schemas');
mkdirSync(schemasDir, { recursive: true });

const schemas = allJsonSchemas();
for (const existing of readdirSync(schemasDir)) {
  if (existing.endsWith('.schema.json') && !(existing in schemas)) rmSync(join(schemasDir, existing));
}
for (const [file, schema] of Object.entries(schemas))
  writeFileSync(join(schemasDir, file), serializeJsonSchema(schema));

// Example projects carry their own copy for editor validation.
const examples = join(repo, 'examples');
for (const example of existsSync(examples) ? readdirSync(examples) : []) {
  const dir = join(examples, example, '.td2d', 'schemas');
  if (!existsSync(dir)) continue;
  for (const existing of readdirSync(dir)) if (!(existing in schemas)) rmSync(join(dir, existing));
  for (const [file, schema] of Object.entries(schemas)) writeFileSync(join(dir, file), serializeJsonSchema(schema));
}

const referenceDir = join(repo, 'docs', 'reference');
mkdirSync(referenceDir, { recursive: true });
writeFileSync(join(referenceDir, 'errors.md'), renderErrorReference());
writeFileSync(join(referenceDir, 'schemas.md'), renderSchemaReference());

process.stdout.write(
  `Wrote ${Object.keys(schemas).length} schemas, example schema copies, docs/reference/errors.md and schemas.md\n`,
);
