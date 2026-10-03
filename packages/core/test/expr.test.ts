import { describe, expect, it } from 'vitest';
import { evaluate, substitute } from '../src/model/expr.ts';

describe('evaluate', () => {
  it('does arithmetic with precedence, parentheses and unary minus', () => {
    expect(evaluate('1 + 2 * 3', {})).toBe(7);
    expect(evaluate('(1 + 2) * 3', {})).toBe(9);
    expect(evaluate('-height / 2', { height: 3 })).toBe(-1.5);
    expect(evaluate('10 % 4 - 1e-1', {})).toBeCloseTo(1.9, 12);
  });

  it('calls the allowed functions and reads parameters', () => {
    expect(evaluate('max(width, 2) + round(0.6)', { width: 1 })).toBe(3);
    expect(evaluate('sqrt(abs(-16))', {})).toBe(4);
    expect(evaluate('label', { label: 'gate' })).toBe('gate');
    expect(evaluate('true', {})).toBe(true);
  });

  it('rejects unknown names, functions, junk and non-finite results', () => {
    expect(() => evaluate('nope + 1', {})).toThrow(/Unknown parameter "nope"/);
    expect(() => evaluate('process.exit(1)', {})).toThrow();
    expect(() => evaluate('eval(1)', {})).toThrow(/Unknown function/);
    expect(() => evaluate('1 +', {})).toThrow();
    expect(() => evaluate('1 / 0', {})).toThrow(/finite/);
    expect(() => evaluate('label * 2', { label: 'x' })).toThrow(/not a number/);
  });
});

describe('substitute', () => {
  it('replaces whole-string placeholders with typed values and interpolates the rest', () => {
    const errors: string[] = [];
    const out = substitute(
      { size: ['${w}', 1, '${w * 2}'], id: 'post-${n}', keep: 'plain' },
      { w: 0.5, n: 3 },
      (p, m) => errors.push(`${p.join('.')}: ${m}`),
    );
    expect(out).toEqual({ size: [0.5, 1, 1], id: 'post-3', keep: 'plain' });
    expect(errors).toEqual([]);
  });

  it('reports the path of a failing placeholder', () => {
    const errors: string[] = [];
    substitute({ a: [{ b: '${missing}' }] }, {}, (p) => errors.push(p.join('.')));
    expect(errors).toEqual(['a.0.b']);
  });
});
