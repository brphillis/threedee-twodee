import { describe, expect, it } from 'vitest';
import { deepMerge } from '../src/index.ts';

describe('deepMerge', () => {
  it('merges objects recursively and replaces arrays', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });

  it('ignores undefined values and non-object layers', () => {
    expect(deepMerge({ a: 1 }, undefined, 'x', { a: undefined, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('does not mutate its inputs', () => {
    const a = { x: { y: [1] } };
    const out = deepMerge(a, { x: { z: 2 } });
    (out.x as { y: number[] }).y.push(2);
    expect(a).toEqual({ x: { y: [1] } });
  });
});
