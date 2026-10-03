import { z } from 'zod';
import { DOCUMENTS, type DocumentInfo, findDocument } from './registry.ts';

export type JsonSchema = Record<string, unknown>;

export function schemaId(name: string): string {
  return `urn:td2d:schema:${name}:1`;
}

/** Convert a registered document schema to JSON Schema draft 2020-12. */
export function documentJsonSchema(doc: DocumentInfo): JsonSchema {
  const generated = z.toJSONSchema(doc.schema, {
    target: 'draft-2020-12',
    io: doc.kind === 'input' ? 'input' : 'output',
    unrepresentable: 'any',
  }) as JsonSchema;
  const { $schema, ...rest } = generated;
  return {
    $schema,
    $id: schemaId(doc.name),
    title: `td2d ${doc.name}`,
    ...rest,
  };
}

export function jsonSchemaFor(name: string): JsonSchema | undefined {
  const doc = findDocument(name);
  return doc ? documentJsonSchema(doc) : undefined;
}

/** All document schemas keyed by `<name>.schema.json`. */
export function allJsonSchemas(): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const doc of DOCUMENTS) {
    out[`${doc.name}.schema.json`] = documentJsonSchema(doc);
  }
  return out;
}

/** Stable text form used for files on disk. */
export function serializeJsonSchema(schema: JsonSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
