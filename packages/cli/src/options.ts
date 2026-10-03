import { InvalidArgumentError } from 'commander';

/** Commander argument parsers that reject bad values as usage errors (exit code 2). */
export function integer(min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new InvalidArgumentError(`Expected an integer from ${min} to ${max}.`);
    return n;
  };
}

export function positiveNumber(max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > max)
      throw new InvalidArgumentError(`Expected a number above 0 and at most ${max}.`);
    return n;
  };
}

/** A number in [min, max]. */
export function numberBetween(min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new InvalidArgumentError(`Expected a number from ${min} to ${max}.`);
    return n;
  };
}

export function frameSize(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || width < 1 || height < 1 || width > 1024 || height > 1024) {
    throw new InvalidArgumentError('Expected WIDTHxHEIGHT in pixels, such as 32x48, each from 1 to 1024.');
  }
  return { width, height };
}

export function numberList(value: string): number[] {
  const parts = value.split(',').map((p) => p.trim());
  const numbers = parts.map(Number);
  if (parts.some((p) => p === '') || numbers.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new InvalidArgumentError('Expected comma-separated non-negative numbers, such as 0,0.25,0.5.');
  }
  return numbers;
}
