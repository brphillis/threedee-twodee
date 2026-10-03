import type { Document } from '@gltf-transform/core';
import type { PartDefinitionT, ResolvedAssetT, WarningT } from '@td2d/schema';
import { Box3, type BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Td2dError } from '../errors.ts';
import type { Logger } from '../logger.ts';
import { combine } from './csg.ts';
import { colourVariantName } from './expand.ts';
import { addGeometryPrimitive, newDocument, writeGlb } from './gltf.ts';
import { importPieces } from './import.ts';
import { type Attachment, type BuiltLeaf, isClosed, prepareGeometry, triangleCount } from './leaves.ts';
import { PART_VERSIONS, type PrimitivePart, partBuilder, partMatrix } from './parts.ts';

/** More triangles than this is an error. */
export const TRIANGLE_LIMIT = 50_000;
/** More triangles than this is a warning. */
export const TRIANGLE_WARNING = 20_000;

/** What geometry depends on: expanded parts and imported file hashes. Colours are applied at render time. */
export function modelInputs(asset: Pick<ResolvedAssetT, 'model'>) {
  return { model: asset.model, builders: PART_VERSIONS };
}

type Bounds = { readonly min: [number, number, number]; readonly max: [number, number, number] };

export interface ModelReport {
  readonly bounds: Bounds;
  readonly size: [number, number, number];
  readonly triangles: number;
  readonly vertices: number;
  readonly materials: Readonly<Record<string, { triangles: number }>>;
  readonly parts: readonly {
    id: string;
    type: string;
    material: string;
    triangles: number;
    bounds: Bounds;
    closed: boolean;
    /** glTF node holding the part: "model", "part:<bone>" or "skin:<part id>". */
    node: string;
    bone: string | null;
    skin: Attachment['skin'];
  }[];
  readonly validator: {
    readonly available: boolean;
    readonly errors: number;
    readonly warnings: number;
    readonly messages: readonly { code: string; message: string; pointer?: string }[];
  };
}

export interface BuiltModel {
  readonly glb: Uint8Array;
  readonly document: Document;
  readonly report: ModelReport;
  readonly warnings: readonly WarningT[];
}

export interface BuildContext {
  readonly projectRoot: string;
  readonly sourceFile: string;
  readonly logger?: Logger;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function boundsOf(geometries: readonly BufferGeometry[]): Bounds {
  const box = new Box3();
  for (const g of geometries) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  if (box.isEmpty()) return { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: [round(box.min.x), round(box.min.y), round(box.min.z)],
    max: [round(box.max.x), round(box.max.y), round(box.max.z)],
  };
}

async function collect(
  parts: readonly PartDefinitionT[],
  parent: Matrix4,
  ctx: BuildContext,
  path: string,
): Promise<BuiltLeaf[]> {
  const out: BuiltLeaf[] = [];
  for (const [i, part] of parts.entries()) out.push(...(await collectOne(part, parent, ctx, `${path}[${i}]`)));
  return out;
}

function attachmentOf(part: PartDefinitionT): Attachment {
  return { bone: part.bone ?? null, skin: part.skin ?? 'rigid', skinBones: part.skinBones ?? null };
}

/** Node name for the geometry that moves together: one node per bone, one per skinned part. */
export function attachmentNode(leaf: Pick<BuiltLeaf, 'id' | 'attach'>): string {
  const a = leaf.attach;
  if (!a || (a.skin === 'rigid' && a.bone === null)) return 'model';
  return a.skin === 'rigid' ? `part:${a.bone}` : `skin:${leaf.id}`;
}

async function collectOne(part: PartDefinitionT, parent: Matrix4, ctx: BuildContext, at: string): Promise<BuiltLeaf[]> {
  const leaves = await collectInner(part, parent, ctx, at);
  const attach = attachmentOf(part);
  return leaves.map((l) => (l.attach ? l : { ...l, attach }));
}

async function collectInner(
  part: PartDefinitionT,
  parent: Matrix4,
  ctx: BuildContext,
  at: string,
): Promise<BuiltLeaf[]> {
  const out: BuiltLeaf[] = [];
  if (part.visible === false) return out;
  {
    const matrix = parent.clone().multiply(partMatrix(part));
    switch (part.type) {
      case 'group':
        out.push(...(await collect(part.parts, matrix, ctx, `${at}.parts`)));
        break;
      case 'csg': {
        const operands = [];
        for (const [k, operand] of part.parts.entries())
          operands.push(await collectOne(operand, new Matrix4(), ctx, `${at}.parts[${k}]`));
        out.push(
          ...(await combine(
            part.op,
            operands,
            { id: part.id, file: ctx.sourceFile, path: at },
            matrix,
            prepareGeometry,
          )),
        );
        break;
      }
      case 'import': {
        for (const piece of await importPieces(part, ctx.projectRoot, ctx.sourceFile, at)) {
          const geometry = prepareGeometry(piece.geometry, matrix);
          out.push({
            id: part.id,
            type: 'import',
            material: piece.material,
            geometry,
            closed: isClosed(geometry),
            file: ctx.sourceFile,
            path: at,
          });
        }
        break;
      }
      case 'component':
        throw new Td2dError('E_INTERNAL', `Component "${part.id}" was not expanded before building.`);
      default: {
        const leaf = part as PrimitivePart;
        const geometry = prepareGeometry(
          partBuilder(leaf.type).build(leaf as never, { file: ctx.sourceFile, path: at }),
          matrix,
        );
        const material = leaf.color !== undefined ? colourVariantName(leaf.material, leaf.id) : leaf.material;
        out.push({
          id: leaf.id,
          type: leaf.type,
          material,
          geometry,
          closed: isClosed(geometry),
          file: ctx.sourceFile,
          path: at,
        });
      }
    }
  }
  return out;
}

/** Give every geometry the same attributes so they can be merged: white vertex colours where missing. */
function harmonise(geometries: BufferGeometry[]): BufferGeometry[] {
  const anyColour = geometries.some((g) => g.getAttribute('color'));
  return geometries.map((g) => {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (anyColour && !g.getAttribute('color'))
      g.setAttribute(
        'color',
        new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3),
      );
    return g;
  });
}

export async function validateGlb(glb: Uint8Array, logger?: Logger): Promise<ModelReport['validator']> {
  try {
    const validator = await import('gltf-validator');
    const report = await validator.validateBytes(glb, { maxIssues: 50 });
    const messages = report.issues.messages
      .filter((m) => m.severity <= 1)
      .map((m) => ({ code: m.code, message: m.message, ...(m.pointer ? { pointer: m.pointer } : {}) }));
    return { available: true, errors: report.issues.numErrors, warnings: report.issues.numWarnings, messages };
  } catch (error) {
    logger?.warn('glTF validator failed to run', { message: (error as Error).message });
    return { available: false, errors: 0, warnings: 0, messages: [] };
  }
}

/**
 * Build the asset's geometry as one GLB. Parts are generated, transformed through their
 * groups, combined by CSG where asked, merged per material and welded. Materials carry
 * names only; colour is applied at render time.
 */
export async function buildModel(
  asset: Pick<ResolvedAssetT, 'model' | 'sourceFile'>,
  ctx: Omit<BuildContext, 'sourceFile'> = { projectRoot: '.' },
): Promise<BuiltModel> {
  const context: BuildContext = { ...ctx, sourceFile: asset.sourceFile };
  const leaves = await collect(asset.model.parts, new Matrix4(), context, 'model.parts');
  const nonEmpty = leaves.filter((l) => triangleCount(l.geometry) > 0);
  if (nonEmpty.length === 0) {
    throw new Td2dError('E_ASSET_INVALID', `${asset.sourceFile} has no visible geometry.`, {
      file: asset.sourceFile,
      issues: [
        {
          file: asset.sourceFile,
          path: 'model.parts',
          message: 'Every part is hidden or empty; at least one must produce triangles',
          code: 'no_visible_parts',
        },
      ],
    });
  }
  const total = nonEmpty.reduce((n, l) => n + triangleCount(l.geometry), 0);
  if (total > TRIANGLE_LIMIT) {
    throw new Td2dError(
      'E_MODEL_TOO_COMPLEX',
      `${asset.sourceFile} builds ${total} triangles, more than the limit of ${TRIANGLE_LIMIT}.`,
      {
        file: asset.sourceFile,
        details: {
          triangles: total,
          parts: nonEmpty
            .map((l) => ({ id: l.id, triangles: triangleCount(l.geometry) }))
            .sort((a, b) => b.triangles - a.triangles)
            .slice(0, 10),
        },
      },
    );
  }

  // Geometry that moves together shares a node: the static model, each bone, each skinned part.
  // Within a node, geometry is merged per material and welded.
  const byNode = new Map<string, { attach: Attachment | undefined; byMaterial: Map<string, BufferGeometry[]> }>();
  for (const leaf of nonEmpty) {
    const node = attachmentNode(leaf);
    const entry = byNode.get(node) ?? { attach: leaf.attach, byMaterial: new Map<string, BufferGeometry[]>() };
    entry.byMaterial.set(leaf.material, [...(entry.byMaterial.get(leaf.material) ?? []), leaf.geometry.clone()]);
    byNode.set(node, entry);
  }

  const doc = newDocument();
  const scene = doc.createScene('asset');
  const gltfMaterials = new Map<string, ReturnType<typeof doc.createMaterial>>();
  const materials: Record<string, { triangles: number }> = {};
  const welded: BufferGeometry[] = [];
  let vertices = 0;
  let triangles = 0;
  const nodeNames = [...byNode.keys()].sort((a, b) =>
    a === 'model' ? -1 : b === 'model' ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );
  for (const nodeName of nodeNames) {
    const { attach, byMaterial } = byNode.get(nodeName) as {
      attach: Attachment | undefined;
      byMaterial: Map<string, BufferGeometry[]>;
    };
    const mesh = doc.createMesh(nodeName === 'model' ? 'model' : nodeName);
    for (const name of [...byMaterial.keys()].sort()) {
      const merged = mergeGeometries(harmonise(byMaterial.get(name) as BufferGeometry[]), false);
      if (!merged) throw new Td2dError('E_GENERATION_FAILED', `Could not merge the geometry for material "${name}".`);
      const geometry = mergeVertices(merged, 1e-6);
      welded.push(geometry);
      let material = gltfMaterials.get(name);
      if (!material) {
        material = doc
          .createMaterial(name)
          .setBaseColorFactor([0.5, 0.5, 0.5, 1])
          .setMetallicFactor(0)
          .setRoughnessFactor(1)
          .setExtras({ td2d: { material: name } });
        gltfMaterials.set(name, material);
      }
      addGeometryPrimitive(doc, mesh, geometry, material);
      const t = triangleCount(geometry);
      materials[name] = { triangles: (materials[name]?.triangles ?? 0) + t };
      triangles += t;
      vertices += geometry.getAttribute('position').count;
    }
    const node = doc.createNode(nodeName).setMesh(mesh);
    if (nodeName !== 'model' && attach)
      node.setExtras({ td2d: { bone: attach.bone, skin: attach.skin, skinBones: attach.skinBones } });
    scene.addChild(node);
  }
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0] ?? null);
  const glb = await writeGlb(doc);
  const validator = await validateGlb(glb, ctx.logger);
  if (validator.errors > 0) {
    throw new Td2dError(
      'E_GENERATION_FAILED',
      `The built model failed glTF validation with ${validator.errors} error(s).`,
      { details: { messages: validator.messages } },
    );
  }

  const bounds = boundsOf(welded);
  const parts = new Map<string, ModelReport['parts'][number] & { geometries: BufferGeometry[] }>();
  for (const leaf of nonEmpty) {
    const entry = parts.get(leaf.id) ?? {
      id: leaf.id,
      type: leaf.type,
      material: leaf.material,
      triangles: 0,
      bounds,
      closed: true,
      node: attachmentNode(leaf),
      bone: leaf.attach?.bone ?? null,
      skin: leaf.attach?.skin ?? 'rigid',
      geometries: [],
    };
    entry.geometries.push(leaf.geometry);
    parts.set(leaf.id, {
      ...entry,
      triangles: entry.triangles + triangleCount(leaf.geometry),
      closed: entry.closed && leaf.closed,
    });
  }
  const warnings: WarningT[] = [];
  if (triangles > TRIANGLE_WARNING) {
    warnings.push({
      code: 'W_TRIANGLE_BUDGET',
      message: `The model has ${triangles} triangles. Sprites rarely need more than ${TRIANGLE_WARNING}.`,
      file: asset.sourceFile,
      hint: 'Lower segment counts or simplify imported models.',
    });
  }
  if (bounds.min[1] < -1e-4) {
    warnings.push({
      code: 'W_MODEL_BELOW_GROUND',
      message: `The model reaches ${bounds.min[1]} m, below the ground at y = 0. The ground line and shadows assume the base is at 0.`,
      file: asset.sourceFile,
      hint: 'Raise the parts, or set align: base on imports.',
    });
  }
  return {
    glb,
    document: doc,
    report: {
      bounds,
      size: [
        round(bounds.max[0] - bounds.min[0]),
        round(bounds.max[1] - bounds.min[1]),
        round(bounds.max[2] - bounds.min[2]),
      ],
      triangles,
      vertices,
      materials,
      parts: [...parts.values()].map(({ geometries, ...p }) => ({ ...p, bounds: boundsOf(geometries) })),
      validator,
    },
    warnings,
  };
}
