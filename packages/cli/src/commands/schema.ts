import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Td2dError } from '@td2d/core';
import { allJsonSchemas, DOCUMENTS, jsonSchemaFor, serializeJsonSchema } from '@td2d/schema';
import type { Command } from 'commander';
import { action } from '../run.ts';

function listing() {
  return DOCUMENTS.map((d) => ({ name: d.name, kind: d.kind, description: d.description, location: d.location }));
}

export function registerSchema(program: Command): void {
  program
    .command('schema')
    .description(
      'Print the JSON Schema for a document type, list document types, or write every schema to a directory.',
    )
    .argument('[name]', 'Document type, such as asset or project')
    .option('--list', 'List document types')
    .option('--write <dir>', 'Write every schema to <dir> as <name>.schema.json')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d schema --list\n  $ td2d schema asset > asset.schema.json\n  $ td2d schema --write .td2d/schemas\n\nWithout --json the schema itself is printed, so the output is a valid JSON Schema document.\n',
    )
    .action(
      action((ctx, name: string | undefined, opts: { list?: boolean; write?: string }) => {
        if (opts.write !== undefined) {
          const dir = resolve(ctx.cwd, opts.write);
          mkdirSync(dir, { recursive: true });
          const files = Object.entries(allJsonSchemas()).map(([file, schema]) => {
            writeFileSync(join(dir, file), serializeJsonSchema(schema));
            return file;
          });
          return {
            data: { dir, files },
            human: (d: { dir: string; files: string[] }) => `Wrote ${d.files.length} schemas to ${d.dir}`,
          };
        }
        if (name === undefined || opts.list) {
          return {
            data: { schemas: listing() },
            human: (d: { schemas: ReturnType<typeof listing> }) =>
              d.schemas
                .map((s) => `${s.name.padEnd(20)} ${s.kind.padEnd(7)} ${s.description} (${s.location})`)
                .join('\n'),
          };
        }
        const schema = jsonSchemaFor(name);
        if (!schema) {
          throw new Td2dError('E_SCHEMA_NOT_FOUND', `There is no schema named "${name}".`, {
            details: { available: DOCUMENTS.map((d) => d.name) },
          });
        }
        return {
          data: { name, schema },
          human: (d: { schema: unknown }) => serializeJsonSchema(d.schema as Record<string, unknown>),
        };
      }),
    );
}
