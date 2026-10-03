import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { AssetDefinition, allJsonSchemas, DOCUMENTS, jsonSchemaFor, serializeJsonSchema } from '../src/index.ts';

const schemasDir = join(import.meta.dirname, '..', '..', '..', 'schemas');

describe('JSON Schema emission', () => {
  const schemas = allJsonSchemas();

  it('emits one schema per registered document', () => {
    expect(Object.keys(schemas).sort()).toEqual(DOCUMENTS.map((d) => `${d.name}.schema.json`).sort());
  });

  it('produces schemas that ajv compiles in strict mode', () => {
    const ajv = new Ajv2020.default({ strict: false, allErrors: true });
    for (const [file, schema] of Object.entries(schemas)) {
      expect(() => ajv.compile(schema), file).not.toThrow();
    }
  });

  it('validates the asset examples with an independent validator', () => {
    const ajv = new Ajv2020.default({ strict: false });
    const validate = ajv.compile(jsonSchemaFor('asset') as object);
    for (const example of (AssetDefinition.meta()?.examples ?? []) as unknown[]) {
      expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(validate({ schemaVersion: '1.0.0', type: 'prop', model: { parts: [] } })).toBe(false);
  });

  it('marks asset objects as closed so editors flag typos', () => {
    const asset = jsonSchemaFor('asset') as { additionalProperties?: unknown };
    expect(asset.additionalProperties).toBe(false);
  });

  it('matches the copies in example projects (run `pnpm generate` to update)', () => {
    const examples = join(schemasDir, '..', 'examples');
    // Every example project (a folder with td2d.project.json) carries the schemas.
    for (const example of readdirSync(examples).filter((e) => existsSync(join(examples, e, 'td2d.project.json')))) {
      const dir = join(examples, example, '.td2d', 'schemas');
      for (const [file, schema] of Object.entries(schemas)) {
        expect(readFileSync(join(dir, file), 'utf8'), `${example}/${file}`).toBe(serializeJsonSchema(schema));
      }
    }
  });

  it('matches the committed files in schemas/ (run `pnpm generate` to update)', () => {
    const committed = readdirSync(schemasDir)
      .filter((f) => f.endsWith('.schema.json'))
      .sort();
    expect(committed).toEqual(Object.keys(schemas).sort());
    for (const [file, schema] of Object.entries(schemas)) {
      expect(readFileSync(join(schemasDir, file), 'utf8'), file).toBe(serializeJsonSchema(schema));
    }
  });
});
