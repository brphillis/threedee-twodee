import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** "sha256:<hex>", the form used in manifests and records. */
export function sha256Tag(data: string | Uint8Array): string {
  return `sha256:${sha256Hex(data)}`;
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
