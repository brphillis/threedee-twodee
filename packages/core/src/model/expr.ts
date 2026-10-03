/**
 * A small, safe expression language for component placeholders such as "${height / 2}".
 * Numbers, parameter names, + - * / %, parentheses, unary minus, and the functions
 * min, max, abs, floor, ceil, round, sqrt. There is no access to anything else.
 */

export type ParamValue = number | string | boolean;

export class ExpressionError extends Error {}

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(i));
      if (!match) throw new ExpressionError(`Bad number at "${source.slice(i)}"`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ kind: 'id', value: match[0] });
      i += match[0].length;
    } else if ('+-*/%(),'.includes(c)) {
      tokens.push({ kind: 'op', value: c });
      i++;
    } else {
      throw new ExpressionError(`Unexpected "${c}"`);
    }
  }
  return tokens;
}

/** Evaluate an expression against parameter values. */
export function evaluate(source: string, params: Readonly<Record<string, ParamValue>>): ParamValue {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (value?: string) => {
    const t = tokens[pos];
    if (!t || (value !== undefined && t.value !== value))
      throw new ExpressionError(value ? `Expected "${value}"` : 'Unexpected end of expression');
    pos++;
    return t;
  };
  const num = (v: ParamValue, what: string): number => {
    if (typeof v !== 'number') throw new ExpressionError(`${what} is not a number`);
    return v;
  };

  const primary = (): ParamValue => {
    const t = take();
    if (t.kind === 'num') return t.value;
    if (t.kind === 'op' && t.value === '(') {
      const v = expression();
      take(')');
      return v;
    }
    if (t.kind === 'op' && t.value === '-') return -num(primary(), 'The value after "-"');
    if (t.kind === 'id') {
      if (peek()?.value === '(') {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new ExpressionError(`Unknown function "${t.value}"`);
        take('(');
        const args: number[] = [];
        if (peek()?.value !== ')') {
          args.push(num(expression(), `An argument of ${t.value}`));
          while (peek()?.value === ',') {
            take(',');
            args.push(num(expression(), `An argument of ${t.value}`));
          }
        }
        take(')');
        return fn(...args);
      }
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (!Object.hasOwn(params, t.value)) throw new ExpressionError(`Unknown parameter "${t.value}"`);
      return params[t.value] as ParamValue;
    }
    throw new ExpressionError(`Unexpected "${t.value}"`);
  };
  const term = (): ParamValue => {
    let left = primary();
    while (peek()?.kind === 'op' && '*/%'.includes(peek()?.value as string)) {
      const op = take().value;
      const right = num(primary(), 'The right-hand side');
      const l = num(left, 'The left-hand side');
      left = op === '*' ? l * right : op === '/' ? l / right : l % right;
    }
    return left;
  };
  function expression(): ParamValue {
    let left = term();
    while (peek()?.kind === 'op' && '+-'.includes(peek()?.value as string)) {
      const op = take().value;
      const right = num(term(), 'The right-hand side');
      left = op === '+' ? num(left, 'The left-hand side') + right : num(left, 'The left-hand side') - right;
    }
    return left;
  }

  const value = expression();
  if (pos < tokens.length) throw new ExpressionError(`Unexpected "${tokens[pos]?.value}"`);
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new ExpressionError('The result is not a finite number');
  return value;
}

const PLACEHOLDER = /\$\{([^}]*)\}/g;

/**
 * Replace "${...}" placeholders in every string of a JSON value. A string that is exactly
 * one placeholder takes the expression's value and type; otherwise results are joined as text.
 * `onError` receives the path of each failing placeholder.
 */
export function substitute(
  value: unknown,
  params: Readonly<Record<string, ParamValue>>,
  onError: (path: (string | number)[], message: string) => void,
  path: (string | number)[] = [],
): unknown {
  if (typeof value === 'string') {
    const whole = /^\$\{([^}]*)\}$/.exec(value);
    try {
      if (whole) return evaluate(whole[1] as string, params);
      return value.replace(PLACEHOLDER, (_m, expr: string) => String(evaluate(expr, params)));
    } catch (error) {
      onError(path, `${value}: ${(error as Error).message}`);
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((v, i) => substitute(v, params, onError, [...path, i]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params, onError, [...path, k])]));
  }
  return value;
}
