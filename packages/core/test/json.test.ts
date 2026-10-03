import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatJson,
  lineAndColumn,
  MAX_JSON_BYTES,
  parseJsonText,
  readJsonFile,
  type Td2dError,
} from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

function parseError(text: string): Td2dError {
  try {
    parseJsonText(text, 'x.json');
  } catch (error) {
    return error as Td2dError;
  }
  throw new Error('expected a parse error');
}

describe('JSON helpers', () => {
  it('computes line and column', () => {
    expect(lineAndColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(lineAndColumn('abc', 0)).toEqual({ line: 1, column: 1 });
  });

  it('reports the line and column of a syntax error', () => {
    const error = parseError('{\n  "a": 1,,\n}');
    expect(error.code).toBe('E_JSON_PARSE');
    expect(error.issues?.[0]?.message).toMatch(/line 2, column 10/);
    expect(error.issues?.[0]?.file).toBe('x.json');
  });

  it('reports truncated documents', () => {
    expect(parseError('{"a": ').issues?.[0]?.message).toMatch(/line 1/);
  });

  it('rejects comments and trailing commas', () => {
    expect(parseError('{ // no\n "a": 1 }').code).toBe('E_JSON_PARSE');
    expect(parseError('{ "a": 1, }').code).toBe('E_JSON_PARSE');
  });

  it('accepts a byte order mark', () => {
    expect(parseJsonText('﻿{"a":1}', 'x.json')).toEqual({ a: 1 });
  });

  it('refuses oversized files', () => {
    const dir = tempDir();
    const file = join(dir, 'big.json');
    writeFileSync(file, `"${'x'.repeat(MAX_JSON_BYTES)}"`);
    expect(() => readJsonFile(file, 'big.json')).toThrowError(/larger than/);
  });

  it('expands the document and keeps short leaf values on one line', () => {
    const text = formatJson({
      a: [1, 2],
      b: { c: 1 },
      d: { e: { f: 1 } },
      parts: [{ id: 'x', size: [1, 1, 1] }],
      empty: {},
      none: [],
    });
    expect(text).toBe(
      '{\n  "a": [1, 2],\n  "b": { "c": 1 },\n  "d": {\n    "e": { "f": 1 }\n  },\n  "parts": [\n    { "id": "x", "size": [1, 1, 1] }\n  ],\n  "empty": {},\n  "none": []\n}\n',
    );
  });

  it('expands leaf values that do not fit the line width', () => {
    const text = formatJson({ list: Array.from({ length: 40 }, (_, i) => i) }, 40);
    expect(text.split('\n').length).toBeGreaterThan(40);
    expect(JSON.parse(text)).toEqual({ list: Array.from({ length: 40 }, (_, i) => i) });
  });

  it('round-trips arbitrary values', () => {
    const value = { s: 'a"b', n: -1.5e-7, t: true, z: null, nested: [[1, [2]], { k: [] }], u: undefined };
    expect(JSON.parse(formatJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });
});
