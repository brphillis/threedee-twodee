import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { allJsonSchemas, serializeJsonSchema } from '@td2d/schema';
import { Td2dError } from './errors.ts';
import { readJsonFile, writeJsonFile } from './fs/json.ts';
import { toPosix } from './fs/paths.ts';
import { TEMPLATES_DIR } from './package-paths.ts';
import { PROJECT_FILE } from './project/project.ts';

export const SCHEMAS_DIR = '.td2d/schemas';

/** Template files are stored without a leading dot so npm keeps them; these are renamed on copy. */
const DOTFILE_RENAMES: Record<string, string> = { gitignore: '.gitignore' };

export function listProjectTemplates(): string[] {
  const dir = join(TEMPLATES_DIR, 'projects');
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Write every JSON Schema into <root>/.td2d/schemas. Returns the files written, relative to root. */
export function writeProjectSchemas(root: string, dir: string = join(root, SCHEMAS_DIR)): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [file, schema] of Object.entries(allJsonSchemas())) {
    writeFileSync(join(dir, file), serializeJsonSchema(schema));
    written.push(toPosix(relative(root, join(dir, file))));
  }
  return written;
}

export interface InitOptions {
  readonly dir: string;
  readonly template?: string;
  readonly name?: string;
}

export interface InitResult {
  readonly root: string;
  readonly template: string;
  readonly name: string;
  readonly files: readonly string[];
}

/** Create a project from a template. Never overwrites an existing file. */
export function initProject(options: InitOptions): InitResult {
  const root = resolve(options.dir);
  const template = options.template ?? 'starter';
  const templateDir = join(TEMPLATES_DIR, 'projects', template);
  if (!existsSync(templateDir)) {
    throw new Td2dError('E_TEMPLATE_NOT_FOUND', `Project template "${template}" does not exist.`, {
      details: { available: listProjectTemplates() },
    });
  }
  if (existsSync(join(root, PROJECT_FILE))) {
    throw new Td2dError('E_PROJECT_EXISTS', `${join(root, PROJECT_FILE)} already exists.`, { details: { root } });
  }

  const plan = walkFiles(templateDir).map((source) => {
    const rel = toPosix(relative(templateDir, source));
    const parts = rel.split('/');
    const last = parts.pop() ?? '';
    const target = [...parts, DOTFILE_RENAMES[last] ?? last].join('/');
    return { source, target, absolute: join(root, target) };
  });
  const conflicts = plan.filter((p) => existsSync(p.absolute)).map((p) => p.target);
  if (existsSync(join(root, SCHEMAS_DIR))) conflicts.push(SCHEMAS_DIR);
  if (conflicts.length > 0) {
    throw new Td2dError(
      'E_INIT_CONFLICT',
      `Creating the project would overwrite ${conflicts.length} existing file(s).`,
      {
        details: { root, conflicts },
      },
    );
  }

  const name = options.name ?? (basename(root) || 'td2d-project');
  for (const item of plan) {
    mkdirSync(dirname(item.absolute), { recursive: true });
    if (item.target === PROJECT_FILE) {
      const config = readJsonFile(item.source, PROJECT_FILE) as Record<string, unknown>;
      writeJsonFile(item.absolute, { ...config, name });
    } else {
      copyFileSync(item.source, item.absolute);
    }
  }
  const schemaFiles = writeProjectSchemas(root);
  return { root, template, name, files: [...plan.map((p) => p.target), ...schemaFiles] };
}
