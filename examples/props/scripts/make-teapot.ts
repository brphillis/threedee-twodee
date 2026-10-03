// Writes assets/props/teapot/import/teapot.glb, a stand-in for a model made in another tool.
// Run from the repository root: node examples/props/scripts/make-teapot.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addGeometryPrimitive, addTd2dMaterial, newDocument, writeGlb } from '@td2d/core';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';

const doc = newDocument();
const material = addTd2dMaterial(doc, {
  name: 'porcelain',
  color: '#f0ece0',
  shading: 'lambert',
  bands: 3,
  emissive: '#000000',
  outline: false,
});
const mesh = doc.createMesh('teapot');
// TeapotGeometry is in centimetre-like units, about 30 across; the asset imports it with units 0.025.
addGeometryPrimitive(doc, mesh, new TeapotGeometry(10, 6, true, true, true, false, true), material);
doc.createScene('teapot').addChild(doc.createNode('teapot').setMesh(mesh));
writeFileSync(
  join(import.meta.dirname, '..', 'assets', 'props', 'teapot', 'import', 'teapot.glb'),
  await writeGlb(doc),
);
