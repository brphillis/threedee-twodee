import type { z } from 'zod';
import type { IssueT } from './documents/cli.ts';

/** Format a zod path such as ["model", "parts", 2, "size"] as "model.parts[2].size". */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      const key = String(segment);
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        out += out === '' ? key : `.${key}`;
      } else {
        out += `[${JSON.stringify(key)}]`;
      }
    }
  }
  return out;
}

type ZodIssue = z.core.$ZodIssue;

/** What a schema-aware conversion may use: the input, to echo values, and the schema, to suggest keys. */
export interface IssueContext {
  readonly input?: unknown;
  readonly schema?: z.ZodType;
}

/**
 * Edit distance where swapping two neighbouring letters counts as one edit (optimal string
 * alignment), for suggesting the key that was probably meant.
 */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => (d[i] as number[])[j] as number;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      (d[i] as number[])[j] = best;
    }
  }
  return at(a.length, b.length);
}

/** The closest of `options` to `word`, if it is close enough to be a likely typo. */
export function closest(word: string, options: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const d = editDistance(word.toLowerCase(), option.toLowerCase());
    if (d < bestDistance) {
      best = option;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return value;
}

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  in?: z.ZodType;
  options?: z.ZodType[];
  valueType?: z.ZodType;
  getter?: () => z.ZodType;
  discriminator?: string;
  values?: unknown[];
}

const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Strip wrappers, and pick the union member that fits `value` best. */
function unwrap(schema: z.ZodType, value: unknown): z.ZodType {
  for (let i = 0; i < 32; i++) {
    const def = defOf(schema);
    if (
      def.innerType &&
      ['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional'].includes(def.type)
    ) {
      schema = def.innerType;
      continue;
    }
    if (def.type === 'pipe' && def.in) {
      schema = def.in;
      continue;
    }
    if (def.type === 'lazy' && def.getter) {
      schema = def.getter();
      continue;
    }
    if (def.type === 'union' && def.options) {
      const objects = def.options.map((o) => unwrap(o, value)).filter((o) => defOf(o).type === 'object');
      if (objects.length === 0) return schema;
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      if (def.discriminator) {
        const match = objects.find((o) => {
          const literal = defOf(defOf(o).shape?.[def.discriminator as string] as z.ZodType)?.values as unknown;
          return Array.isArray(literal) ? literal.includes(record[def.discriminator as string]) : false;
        });
        if (match) return match;
      }
      // The object member that shares the most keys with the input.
      const score = (o: z.ZodType) => Object.keys(record).filter((k) => k in (defOf(o).shape ?? {})).length;
      return objects.reduce((a, b) => (score(b) > score(a) ? b : a));
    }
    return schema;
  }
  return schema;
}

/** The keys an object at `path` may have, or undefined when the schema there is not an object. */
function keysAt(schema: z.ZodType, input: unknown, path: readonly PropertyKey[]): string[] | undefined {
  let current = schema;
  for (let i = 0; i <= path.length; i++) {
    current = unwrap(current, valueAt(input, path.slice(0, i)));
    if (i === path.length) break;
    const def = defOf(current);
    const segment = path[i];
    if (def.type === 'object' && def.shape && typeof segment === 'string' && def.shape[segment])
      current = def.shape[segment];
    else if (def.type === 'array' && def.element) current = def.element;
    else if (def.type === 'record' && def.valueType) current = def.valueType;
    else return undefined;
  }
  const def = defOf(current);
  return def.type === 'object' && def.shape ? Object.keys(def.shape) : undefined;
}

const show = (value: unknown) => {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

function isRootTypeMismatch(branch: readonly ZodIssue[]): boolean {
  return branch.length === 1 && branch[0]?.code === 'invalid_type' && branch[0].path.length === 0;
}

function flatten(
  issue: ZodIssue,
  prefix: readonly PropertyKey[],
  out: IssueT[],
  file: string | undefined,
  ctx: IssueContext,
): void {
  const path = [...prefix, ...issue.path];
  const base = file === undefined ? {} : { file };

  if (issue.code === 'unrecognized_keys') {
    const allowed = ctx.schema ? keysAt(ctx.schema, ctx.input, path) : undefined;
    const present = (valueAt(ctx.input, path) as object | undefined) ?? {};
    const unused = allowed?.filter((k) => !(k in present)) ?? [];
    for (const key of issue.keys) {
      const suggestion = closest(key, unused);
      // Without a likely typo, list what this object can hold.
      const known = allowed && !suggestion ? `. Allowed here: ${allowed.join(', ')}` : '';
      out.push({
        ...base,
        path: formatPath([...path, key]),
        message: `Unknown property "${key}"${suggestion ? `. Did you mean "${suggestion}"?` : known}`,
        code: 'unknown_property',
      });
    }
    return;
  }

  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    // Report the branch that matched the input's shape instead of every alternative.
    const candidates = issue.errors.filter((branch) => !isRootTypeMismatch(branch));
    if (candidates.length === 1 && candidates[0]) {
      for (const inner of candidates[0]) flatten(inner, path, out, file, ctx);
      return;
    }
  }

  // A required key that is missing reads better as that than as a type mismatch.
  const received = ctx.input === undefined ? undefined : valueAt(ctx.input, path);
  const parent = ctx.input === undefined || path.length === 0 ? undefined : valueAt(ctx.input, path.slice(0, -1));
  const key = path.at(-1);
  if (
    issue.code === 'invalid_type' &&
    received === undefined &&
    parent !== null &&
    typeof parent === 'object' &&
    typeof key === 'string' &&
    !(key in parent)
  ) {
    out.push({
      ...base,
      path: formatPath(path),
      message: `Missing required property "${key}" (expected ${(issue as { expected?: string }).expected ?? 'a value'})`,
      code: 'missing_property',
    });
    return;
  }
  // Say what was received when the message does not.
  const echo =
    received !== undefined &&
    (issue.code === 'invalid_value' || issue.code === 'invalid_format') &&
    !/received/i.test(issue.message)
      ? `, received ${show(received)}`
      : '';
  out.push({ ...base, path: formatPath(path), message: `${issue.message}${echo}`, code: issue.code });
}

/**
 * Turn a zod error into td2d issues with readable paths. With the input and the schema, unknown
 * keys come with the likely intended key and wrong values are echoed.
 */
export function issuesFromZod(error: z.ZodError, file?: string, ctx: IssueContext = {}): IssueT[] {
  const out: IssueT[] = [];
  for (const issue of error.issues) flatten(issue, [], out, file, ctx);
  return out;
}
