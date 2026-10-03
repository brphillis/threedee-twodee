const CHUNK = 0x8000;

/**
 * Base64 for large byte arrays. Uses the native Uint8Array.prototype.toBase64 where it exists
 * (Chromium 140 and later), about 180 times faster than building a string, else falls back to
 * btoa in chunks small enough for String.fromCharCode's argument limit.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
