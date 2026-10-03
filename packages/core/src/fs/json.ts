import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IssueT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';

/** Largest JSON document td2d will read. Asset definitions are far smaller. */
export const MAX_JSON_BYTES: number = 8 * 1024 * 1024;

export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

/** Deepest nesting td2d accepts in a JSON document. Real definitions stay far below it. */
export const MAX_JSON_DEPTH = 100;

/** The deepest bracket nesting in JSON text, ignoring brackets inside strings. */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++;
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123 || c === 91) max = Math.max(max, ++depth);
    else if (c === 125 || c === 93) depth--;
  }
  return max;
}

/** Parse JSON text, turning syntax errors into issues with line and column numbers. */
export function parseJsonText(text: string, file: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const depth = jsonDepth(body);
  if (depth > MAX_JSON_DEPTH) {
    throw new Td2dError(
      'E_JSON_PARSE',
      `${file} nests objects and arrays ${depth} levels deep, more than ${MAX_JSON_DEPTH}.`,
      {
        file,
        issues: [
          { file, path: '', message: `Nested ${depth} levels deep; the limit is ${MAX_JSON_DEPTH}`, code: 'too_deep' },
        ],
      },
    );
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /position (\d+)/.exec(message);
    let where = '';
    if (match?.[1] !== undefined) {
      const { line, column } = lineAndColumn(body, Number(match[1]));
      where = ` at line ${line}, column ${column}`;
    } else if (/end of JSON input/i.test(message)) {
      const { line, column } = lineAndColumn(body, body.length);
      where = ` at line ${line}, column ${column}`;
    }
    const reason = message.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '');
    const issue: IssueT = { file, path: '', message: `Invalid JSON${where}: ${reason}`, code: 'json_syntax' };
    throw new Td2dError('E_JSON_PARSE', `${file} is not valid JSON${where}.`, { file, issues: [issue] });
  }
}

/** Read and parse a JSON file. `displayPath` is used in messages. */
export function readJsonFile(absolutePath: string, displayPath: string): unknown {
  const size = statSync(absolutePath).size;
  if (size > MAX_JSON_BYTES) {
    throw new Td2dError('E_JSON_PARSE', `${displayPath} is larger than ${MAX_JSON_BYTES} bytes.`, {
      file: displayPath,
      issues: [{ file: displayPath, path: '', message: `File is ${size} bytes`, code: 'too_large' }],
    });
  }
  return parseJsonText(readFileSync(absolutePath, 'utf8'), displayPath);
}

/** Default line width for JSON files td2d writes. */
export const JSON_LINE_WIDTH = 100;

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

/** Values that may sit on one line: primitives, and arrays or objects of primitives or primitive arrays. */
function isInlineable(v: unknown): boolean {
  if (isPrimitive(v)) return true;
  const children = Array.isArray(v) ? v : Object.values(v as object);
  return children.every((c) => isPrimitive(c) || (Array.isArray(c) && c.every(isPrimitive)));
}

function inlineForm(v: unknown): string {
  if (isPrimitive(v)) return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.map(inlineForm).join(', ')}]`;
  const entries = Object.entries(v as object).filter(([, c]) => c !== undefined);
  return entries.length === 0
    ? '{}'
    : `{ ${entries.map(([k, c]) => `${JSON.stringify(k)}: ${inlineForm(c)}`).join(', ')} }`;
}

function printJson(v: unknown, indent: number, prefix: number, width: number, top: boolean): string {
  if (isPrimitive(v)) return JSON.stringify(v) ?? 'null';
  if (!top && isInlineable(v)) {
    const flat = inlineForm(v);
    if (indent + prefix + flat.length <= width) return flat;
  }
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((c) => pad + printJson(c, indent + 2, 0, width, false)).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(v as object).filter(([, c]) => c !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, c]) => {
    const key = `${JSON.stringify(k)}: `;
    return pad + key + printJson(c, indent + 2, key.length, width, false);
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}

/**
 * Stable, readable JSON: objects expand, short leaf objects and vectors such as
 * [0, 0.5, 0] stay on one line, and the text ends with a newline.
 */
export function formatJson(value: unknown, width: number = JSON_LINE_WIDTH): string {
  return `${printJson(value, 0, 0, width, true)}\n`;
}

export function writeJsonFile(absolutePath: string, value: unknown): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, formatJson(value));
}
