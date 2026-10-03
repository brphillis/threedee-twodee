import {
  type Accessor,
  type Buffer,
  Document,
  type Material,
  type Mesh,
  NodeIO,
  type Primitive,
} from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import type { BufferGeometry } from 'three';

/** sRGB transfer function, inverse. Colours in definitions are sRGB; glTF factors are linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

export interface Td2dMaterialSpec {
  readonly name: string;
  readonly color: string;
  readonly shading: 'toon' | 'flat' | 'lambert';
  readonly bands: number;
  readonly emissive: string;
  readonly outline: boolean;
}

/** Create the IO used for every GLB td2d reads or writes. */
export function createGltfIo(): NodeIO {
  return new NodeIO().registerExtensions([KHRMaterialsUnlit]);
}

/** The single buffer a GLB needs. */
export function documentBuffer(doc: Document): Buffer {
  return doc.getRoot().listBuffers()[0] ?? doc.createBuffer('main');
}

/**
 * A glTF material carrying td2d shading in `extras.td2d`. The base colour is stored
 * linear, as glTF requires, so any glTF viewer shows the intended colour.
 */
export function addTd2dMaterial(doc: Document, spec: Td2dMaterialSpec): Material {
  const material = doc
    .createMaterial(spec.name)
    .setBaseColorFactor([...hexToLinear(spec.color), 1])
    .setEmissiveFactor(hexToLinear(spec.emissive))
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setExtras({ td2d: { shading: spec.shading, bands: spec.bands, outline: spec.outline } });
  if (spec.shading === 'flat') {
    const unlit = doc.createExtension(KHRMaterialsUnlit);
    material.setExtension('KHR_materials_unlit', unlit.createUnlit());
  }
  return material;
}

function accessor(
  doc: Document,
  name: string,
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4',
  array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
): Accessor {
  return doc.createAccessor(name).setType(type).setArray(array).setBuffer(documentBuffer(doc));
}

export interface GeometryOptions {
  /** Use these indices instead of the geometry's own, for example one material group. */
  readonly indices?: ArrayLike<number>;
}

/** Copy a three.js BufferGeometry into a glTF primitive. Skinning attributes are kept. */
export function addGeometryPrimitive(
  doc: Document,
  mesh: Mesh,
  geometry: BufferGeometry,
  material: Material,
  options: GeometryOptions = {},
): Primitive {
  const primitive = doc.createPrimitive().setMaterial(material);
  const attrs = geometry.attributes;
  if (!attrs.position) throw new Error('Geometry has no position attribute.');
  primitive.setAttribute(
    'POSITION',
    accessor(doc, 'POSITION', 'VEC3', Float32Array.from(attrs.position.array as ArrayLike<number>)),
  );
  if (attrs.normal)
    primitive.setAttribute(
      'NORMAL',
      accessor(doc, 'NORMAL', 'VEC3', Float32Array.from(attrs.normal.array as ArrayLike<number>)),
    );
  if (attrs.uv)
    primitive.setAttribute(
      'TEXCOORD_0',
      accessor(doc, 'TEXCOORD_0', 'VEC2', Float32Array.from(attrs.uv.array as ArrayLike<number>)),
    );
  if (attrs.color) {
    const size = attrs.color.itemSize === 4 ? 'VEC4' : 'VEC3';
    primitive.setAttribute(
      'COLOR_0',
      accessor(doc, 'COLOR_0', size, Float32Array.from(attrs.color.array as ArrayLike<number>)),
    );
  }
  if (attrs.skinIndex && attrs.skinWeight) {
    primitive.setAttribute(
      'JOINTS_0',
      accessor(doc, 'JOINTS_0', 'VEC4', Uint16Array.from(attrs.skinIndex.array as ArrayLike<number>)),
    );
    primitive.setAttribute(
      'WEIGHTS_0',
      accessor(doc, 'WEIGHTS_0', 'VEC4', Float32Array.from(attrs.skinWeight.array as ArrayLike<number>)),
    );
  }
  const source = options.indices ?? (geometry.index?.array as ArrayLike<number> | undefined);
  if (source) {
    const vertexCount = attrs.position.count;
    const indices = vertexCount <= 65535 ? Uint16Array.from(source) : Uint32Array.from(source);
    primitive.setIndices(accessor(doc, 'indices', 'SCALAR', indices));
  }
  mesh.addPrimitive(primitive);
  return primitive;
}

export async function writeGlb(doc: Document): Promise<Uint8Array> {
  return createGltfIo().writeBinary(doc);
}

/**
 * Check a binary glTF's header before parsing it: the magic, version 2, a declared length equal
 * to the file's, and a JSON chunk first. Returns the problem, or null when the header is sound.
 */
export function glbHeaderProblem(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 20) return `it is ${bytes.byteLength} bytes, too short to be a GLB`;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67)
    return 'it does not start with the "glTF" magic, so it is not a binary glTF file';
  const version = view.getUint32(4, true);
  if (version !== 2) return `it is glTF version ${version}; only version 2 is supported`;
  const length = view.getUint32(8, true);
  if (length !== bytes.byteLength)
    return `its header says ${length} bytes but the file has ${bytes.byteLength}, so it is truncated or padded`;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) return 'its first chunk is not the JSON chunk';
  if (20 + jsonLength > bytes.byteLength) return 'its JSON chunk runs past the end of the file';
  return null;
}

/** Parse a GLB after checking its header. */
export async function readGlb(bytes: Uint8Array): Promise<Document> {
  const problem = glbHeaderProblem(bytes);
  if (problem) throw new Error(`Not a valid GLB: ${problem}.`);
  return createGltfIo().readBinary(bytes);
}

export function newDocument(): Document {
  const doc = new Document();
  doc.createBuffer('main');
  return doc;
}
