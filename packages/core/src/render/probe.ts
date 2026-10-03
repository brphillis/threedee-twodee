import { BoxGeometry } from 'three';
import { addGeometryPrimitive, addTd2dMaterial, newDocument, writeGlb } from '../model/gltf.ts';

let cached: Uint8Array | undefined;

/** A half-metre orange cube resting on the ground, used by `td2d doctor` to prove rendering works. */
export async function probeModelGlb(): Promise<Uint8Array> {
  if (cached) return cached;
  const doc = newDocument();
  const material = addTd2dMaterial(doc, {
    name: 'probe',
    color: '#e07040',
    shading: 'toon',
    bands: 3,
    emissive: '#000000',
    outline: false,
  });
  const mesh = doc.createMesh('probe');
  addGeometryPrimitive(doc, mesh, new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), material);
  doc.createScene('probe').addChild(doc.createNode('probe').setMesh(mesh));
  cached = await writeGlb(doc);
  return cached;
}
