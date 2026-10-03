export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge layers left to right. Objects merge recursively, arrays and scalars replace,
 * and undefined values are ignored. Inputs are never mutated.
 */
export function deepMerge(...layers: readonly unknown[]): PlainObject {
  const out: PlainObject = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const existing = out[key];
      out[key] = isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : structuredClone(value);
    }
  }
  return out;
}
