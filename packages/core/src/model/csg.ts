import { BufferGeometry, Float32BufferAttribute, type Matrix4 } from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Td2dError } from '../errors.ts';
import type { BuiltLeaf } from './leaves.ts';

type ManifoldModule = Awaited<ReturnType<typeof import('manifold-3d').default>>;
type Solid = InstanceType<ManifoldModule['Manifold']>;

let modulePromise: Promise<ManifoldModule> | undefined;

/** The manifold-3d WASM module, loaded once per process on first use. */
export function manifoldModule(): Promise<ManifoldModule> {
  modulePromise ??= (async () => {
    const { default: Module } = await import('manifold-3d');
    const wasm = await Module();
    wasm.setup();
    return wasm;
  })();
  return modulePromise;
}

/** Faces meeting at more than this angle keep a hard edge; flatter ones are smoothed. */
const CREASE_ANGLE = (35 * Math.PI) / 180;

export type CsgOp = 'union' | 'subtract' | 'intersect' | 'hull';

function notManifold(leaf: BuiltLeaf, reason: string): Td2dError {
  return new Td2dError('E_PART_NOT_MANIFOLD', `CSG operand "${leaf.id}" is not a closed solid (${reason}).`, {
    file: leaf.file,
    issues: [
      {
        file: leaf.file,
        path: leaf.path,
        message: `Part "${leaf.id}" is not closed and watertight, so it cannot be used in CSG (${reason})`,
        code: 'not_manifold',
      },
    ],
  });
}

function toSolid(wasm: ManifoldModule, leaf: BuiltLeaf, track: Solid[]): Solid {
  const pos = leaf.geometry.getAttribute('position');
  const keys = new Map<string, number>();
  const verts: number[] = [];
  const tris: number[] = [];
  const index = (i: number) => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let n = keys.get(key);
    if (n === undefined) {
      n = verts.length / 3;
      keys.set(key, n);
      verts.push(x, y, z);
    }
    return n;
  };
  for (let t = 0; t < pos.count; t += 3) {
    const a = index(t);
    const b = index(t + 1);
    const c = index(t + 2);
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(verts),
    triVerts: Uint32Array.from(tris),
  });
  mesh.merge();
  let solid: Solid;
  try {
    solid = new wasm.Manifold(mesh);
  } catch (error) {
    throw notManifold(leaf, (error as { code?: string }).code ?? (error as Error).message);
  }
  track.push(solid);
  if (solid.status() !== 'NoError') throw notManifold(leaf, solid.status());
  const original = solid.asOriginal();
  track.push(original);
  return original;
}

/**
 * Combine operands with manifold-3d. Each operand is a list of leaves (a part, or a group's
 * parts) in the CSG part's own frame. The result keeps each source triangle's material and
 * gets creased normals, so flat faces stay flat and curved faces stay smooth.
 */
export async function combine(
  op: CsgOp,
  operands: readonly (readonly BuiltLeaf[])[],
  part: { id: string; file: string; path: string },
  matrix: Matrix4,
  prepare: (g: BufferGeometry, m: Matrix4) => BufferGeometry,
): Promise<BuiltLeaf[]> {
  const wasm = await manifoldModule();
  const track: Solid[] = [];
  const materials = new Map<number, string>();
  try {
    const solids = operands.map((leaves) => {
      let solid: Solid | null = null;
      for (const leaf of leaves) {
        const s = toSolid(wasm, leaf, track);
        materials.set(s.originalID(), leaf.material);
        solid = solid ? solid.add(s) : s;
        track.push(solid);
      }
      return solid;
    });
    const present = solids.filter((s): s is Solid => s !== null);
    if (present.length === 0)
      throw new Td2dError('E_ASSET_INVALID', `CSG part "${part.id}" has no operands to combine.`);
    const [first, ...rest] = present as [Solid, ...Solid[]];
    let result: Solid;
    if (op === 'hull') result = wasm.Manifold.hull(present);
    else if (op === 'union') result = rest.reduce((acc, s) => acc.add(s), first);
    else if (op === 'intersect') result = rest.reduce((acc, s) => acc.intersect(s), first);
    else
      result =
        rest.length === 0 ? first : first.subtract(rest.length === 1 ? (rest[0] as Solid) : wasm.Manifold.union(rest));
    track.push(result);
    const mesh = result.getMesh();
    const fallback = operands[0]?.[0]?.material ?? '';
    const runs = mesh.runIndex ?? Uint32Array.from([0, mesh.triVerts.length]);
    const runIds = mesh.runOriginalID ?? Uint32Array.from([0]);
    const byMaterial = new Map<string, number[]>();
    for (let r = 0; r < runIds.length; r++) {
      const material = materials.get(runIds[r] as number) ?? fallback;
      const list = byMaterial.get(material) ?? [];
      for (let k = runs[r] as number; k < (runs[r + 1] as number); k++) {
        const v = (mesh.triVerts[k] as number) * mesh.numProp;
        list.push(
          mesh.vertProperties[v] as number,
          mesh.vertProperties[v + 1] as number,
          mesh.vertProperties[v + 2] as number,
        );
      }
      byMaterial.set(material, list);
    }
    return [...byMaterial].map(([material, positions]) => {
      const raw = new BufferGeometry();
      raw.setAttribute('position', new Float32BufferAttribute(positions, 3));
      return {
        id: part.id,
        type: 'csg',
        material,
        geometry: prepare(toCreasedNormals(raw, CREASE_ANGLE), matrix),
        closed: true,
        file: part.file,
        path: part.path,
      };
    });
  } finally {
    for (const solid of new Set(track)) solid.delete();
  }
}
