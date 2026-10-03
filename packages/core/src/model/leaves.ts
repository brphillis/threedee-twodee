import type { Matrix4 } from 'three';
import { type BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** One piece of built geometry in model space, with the material it renders with. */
export interface BuiltLeaf {
  readonly id: string;
  readonly type: string;
  readonly material: string;
  readonly geometry: BufferGeometry;
  /** Whether the surface is closed (every edge shared by exactly two triangles). */
  readonly closed: boolean;
  readonly file: string;
  readonly path: string;
  /** How the leaf follows the rig, when it does. */
  readonly attach?: Attachment;
}

/** A part's link to the rig: rigid to one bone, or skinned. */
export interface Attachment {
  readonly bone: string | null;
  readonly skin: 'rigid' | 'nearest-bone' | 'two-bone-blend';
  readonly skinBones: readonly string[] | null;
}

const KEEP = new Set(['position', 'normal', 'color']);

/**
 * Transform into the parent frame and normalise: positions, normals and colours only,
 * non-indexed, winding fixed for mirrored transforms, zero-area triangles removed.
 */
export function prepareGeometry(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  geometry.applyMatrix4(matrix);
  for (const name of Object.keys(geometry.attributes)) if (!KEEP.has(name)) geometry.deleteAttribute(name);
  geometry.clearGroups();
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = flat.getAttribute('position');
  if (!pos) return flat;
  const mirrored = matrix.determinant() < 0;
  const names = Object.keys(flat.attributes);
  const keep: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-20) keep.push(t);
  }
  if (!mirrored && keep.length === pos.count / 3) return flat;
  for (const name of names) {
    const attr = flat.getAttribute(name);
    const size = attr.itemSize;
    const src = attr.array as Float32Array;
    const out = new Float32Array(keep.length * 3 * size);
    keep.forEach((t, i) => {
      const order = mirrored ? [0, 2, 1] : [0, 1, 2];
      for (const [k, v] of order.entries())
        out.set(src.subarray((t * 3 + v) * size, (t * 3 + v + 1) * size), (i * 3 + k) * size);
    });
    flat.setAttribute(name, new Float32BufferAttribute(out, size));
  }
  return flat;
}

/** True when every edge, after welding coincident positions, belongs to exactly two triangles. */
export function isClosed(geometry: BufferGeometry): boolean {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return false;
  const ids = new Map<string, number>();
  const id = (i: number) => {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let n = ids.get(key);
    if (n === undefined) {
      n = ids.size;
      ids.set(key, n);
    }
    return n;
  };
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const vertex = (k: number) => id(index ? index.getX(k) : k);
  const edges = new Map<string, number>();
  for (let t = 0; t < count; t += 3) {
    const tri = [vertex(t), vertex(t + 1), vertex(t + 2)];
    for (let e = 0; e < 3; e++) {
      const p = tri[e] as number;
      const q = tri[(e + 1) % 3] as number;
      if (p === q) continue;
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return edges.size > 0;
}

export function triangleCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
}
