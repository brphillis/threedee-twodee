import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from '@gltf-transform/core';
import type { PartDefinitionT } from '@td2d/schema';
import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { Td2dError } from '../errors.ts';
import { readGlb } from './gltf.ts';

type ImportPart = Extract<PartDefinitionT, { type: 'import' }>;

export interface ImportedPiece {
  readonly material: string;
  readonly geometry: BufferGeometry;
}

function failure(part: ImportPart, file: string, path: string, message: string, cause?: unknown): Td2dError {
  return new Td2dError('E_IMPORT_FAILED', `Import "${part.id}": ${message}`, {
    file,
    issues: [{ file, path: `${path}.src`, message, code: 'import_failed' }],
    ...(cause ? { cause } : {}),
  });
}

/**
 * Read an imported GLB into geometries in the part's own frame: node transforms baked,
 * units applied, aligned as requested, and each glTF material mapped to an asset material.
 */
export async function importPieces(
  part: ImportPart,
  projectRoot: string,
  file: string,
  path: string,
): Promise<ImportedPiece[]> {
  let doc: Awaited<ReturnType<typeof readGlb>>;
  try {
    doc = await readGlb(readFileSync(join(projectRoot, part.src)));
  } catch (error) {
    throw failure(part, file, path, `${part.src} is not a readable GLB: ${(error as Error).message}`, error);
  }
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let roots: Node[] = scene?.listChildren() ?? [];
  if (part.select) {
    const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
    const missing = part.select.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw failure(
        part,
        file,
        path,
        `${part.src} has no node named ${missing.map((m) => `"${m}"`).join(', ')}. Nodes: ${[...byName.keys()].filter(Boolean).slice(0, 30).join(', ')}`,
      );
    }
    roots = part.select.map((name) => byName.get(name) as Node);
  }

  const units = part.units ?? 1;
  const pieces: ImportedPiece[] = [];
  const visit = (node: Node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = new Matrix4()
        .fromArray(node.getWorldMatrix())
        .premultiply(new Matrix4().makeScale(units, units, units));
      for (const primitive of mesh.listPrimitives()) {
        if (primitive.getMode() !== 4) continue;
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position.getArray() ?? []), 3));
        const normal = primitive.getAttribute('NORMAL');
        if (normal) geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(normal.getArray() ?? []), 3));
        const color = primitive.getAttribute('COLOR_0');
        if (color) {
          const size = color.getElementSize();
          const values = new Float32Array(color.getCount() * 3);
          const element: number[] = [];
          for (let i = 0; i < color.getCount(); i++) {
            color.getElement(i, element);
            values.set([element[0] ?? 1, element[1] ?? 1, element[2] ?? 1], i * 3);
          }
          if (size >= 3) geometry.setAttribute('color', new BufferAttribute(values, 3));
        }
        const indices = primitive.getIndices();
        if (indices) geometry.setIndex(Array.from(indices.getArray() ?? []));
        if (!normal) geometry.computeVertexNormals();
        geometry.applyMatrix4(world);
        const name = primitive.getMaterial()?.getName() ?? '';
        pieces.push({ material: part.materialMap?.[name] ?? part.material, geometry });
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  roots.forEach(visit);
  if (pieces.length === 0)
    throw failure(
      part,
      file,
      path,
      `${part.src} contains no triangle meshes${part.select ? ' under the selected nodes' : ''}.`,
    );

  const align = part.align ?? 'base';
  if (align !== 'origin') {
    const box = new Box3();
    for (const p of pieces) {
      p.geometry.computeBoundingBox();
      if (p.geometry.boundingBox) box.union(p.geometry.boundingBox);
    }
    const centre = box.getCenter(new Vector3());
    const offset = new Vector3(-centre.x, align === 'base' ? -box.min.y : -centre.y, -centre.z);
    for (const p of pieces) p.geometry.translate(offset.x, offset.y, offset.z);
  }
  return pieces;
}
