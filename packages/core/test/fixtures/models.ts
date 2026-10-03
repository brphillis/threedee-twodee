import type { Node } from '@gltf-transform/core';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Quaternion,
  SphereGeometry,
  Uint16BufferAttribute,
} from 'three';
import { addGeometryPrimitive, addTd2dMaterial, newDocument, writeGlb } from '../../src/index.ts';

const toon = (name: string, color: string, bands = 3) => ({
  name,
  color,
  shading: 'toon' as const,
  bands,
  emissive: '#000000',
  outline: true,
});

/** A one-metre cube resting on the ground: wood sides, iron top and bottom. */
export async function cubeGlb(): Promise<Uint8Array> {
  const doc = newDocument();
  const wood = addTd2dMaterial(doc, toon('wood', '#a0693a'));
  const iron = addTd2dMaterial(doc, toon('iron', '#5b6770', 2));
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const index = geometry.index?.array as Uint16Array;
  const mesh = doc.createMesh('cube');
  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z.
  const pick = (groups: number[]) =>
    groups.flatMap((g) => {
      const group = geometry.groups[g];
      return group ? Array.from(index.subarray(group.start, group.start + group.count)) : [];
    });
  addGeometryPrimitive(doc, mesh, geometry, wood, { indices: pick([0, 1, 4, 5]) });
  addGeometryPrimitive(doc, mesh, geometry, iron, { indices: pick([2, 3]) });
  doc.createScene('cube').addChild(doc.createNode('cube').setMesh(mesh));
  return writeGlb(doc);
}

/** A barrel-sized cylinder resting on the ground. */
export async function cylinderGlb(): Promise<Uint8Array> {
  const doc = newDocument();
  const material = addTd2dMaterial(doc, toon('barrel', '#8a5a3b'));
  const mesh = doc.createMesh('cylinder');
  addGeometryPrimitive(doc, mesh, new CylinderGeometry(0.4, 0.4, 1, 16).translate(0, 0.5, 0), material);
  doc.createScene('cylinder').addChild(doc.createNode('cylinder').setMesh(mesh));
  return writeGlb(doc);
}

/**
 * A two-metre vertical arm skinned to two bones. The "wave" clip bends the upper bone
 * 90 degrees around Z at t = 0.5 and returns at t = 1.
 */
export async function armGlb(): Promise<Uint8Array> {
  const doc = newDocument();
  const material = addTd2dMaterial(doc, toon('skin', '#e8b796'));
  const geometry = new CylinderGeometry(0.15, 0.15, 2, 8, 16).translate(0, 1, 0);
  const pos = geometry.getAttribute('position');
  const joints: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const w = Math.min(Math.max((pos.getY(i) - 0.75) / 0.5, 0), 1);
    joints.push(0, w > 0 ? 1 : 0, 0, 0);
    weights.push(1 - w, w, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));

  const mesh = doc.createMesh('arm');
  addGeometryPrimitive(doc, mesh, geometry, material);
  const root = doc.createNode('root');
  const tip = doc.createNode('tip').setTranslation([0, 1, 0]);
  root.addChild(tip);
  const ibm = doc
    .createAccessor('inverseBind')
    .setType('MAT4')
    .setBuffer(doc.getRoot().listBuffers()[0] ?? null)
    .setArray(
      new Float32Array([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
      ]),
    );
  const skin = doc.createSkin('arm').addJoint(root).addJoint(tip).setInverseBindMatrices(ibm);
  const armNode = doc.createNode('arm').setMesh(mesh).setSkin(skin);
  doc.createScene('arm').addChild(root).addChild(armNode);

  const bent = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)).toArray();
  const buffer = doc.getRoot().listBuffers()[0] ?? null;
  const input = doc
    .createAccessor('times')
    .setType('SCALAR')
    .setBuffer(buffer)
    .setArray(new Float32Array([0, 0.5, 1]));
  const output = doc
    .createAccessor('rotations')
    .setType('VEC4')
    .setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, ...bent, 0, 0, 0, 1]));
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(tip).setTargetPath('rotation').setSampler(sampler);
  doc.createAnimation('wave').addSampler(sampler).addChannel(channel);
  return writeGlb(doc);
}

export interface WalkerOptions {
  /** Add a "jitter" clip: the walk with the whole figure shifted sideways on every other frame. */
  readonly jitterShift?: number;
  /** Distance in metres the "slide" clip moves the standing figure along +x. Default 1/16 m. */
  readonly slide?: number;
}

/**
 * A capsule figure about 1.85 m tall with two swinging legs, a blue front and a red cape on
 * its back. Clips, all one second long with keys every 1/8 s:
 * - walk: legs swing 25 degrees each way and the body bobs 4 cm, twice per cycle.
 * - turn: the figure turns a full circle on the spot, showing the cape.
 * - jitter (with `jitterShift`): walk, with the figure moved `jitterShift` metres along +x on odd keys.
 * - slide: the standing figure moves `slide` metres along +x at a constant speed.
 */
export async function walkerGlb(options: WalkerOptions = {}): Promise<Uint8Array> {
  const doc = newDocument();
  const tunic = addTd2dMaterial(doc, toon('tunic', '#3b5dc9'));
  const cape = addTd2dMaterial(doc, toon('cape', '#b13e53'));
  const boots = addTd2dMaterial(doc, toon('boots', '#5d275d', 2));
  const skin = addTd2dMaterial(doc, toon('skin', '#ffcd75'));

  const body = doc.createMesh('body');
  addGeometryPrimitive(doc, body, new CapsuleGeometry(0.28, 0.6, 4, 12).translate(0, 1.2, 0), tunic);
  addGeometryPrimitive(doc, body, new SphereGeometry(0.17, 12, 8).translate(0, 1.92, 0), skin);
  addGeometryPrimitive(doc, body, new BoxGeometry(0.5, 0.8, 0.06).translate(0, 1.25, -0.3), cape);
  const legMesh = doc.createMesh('leg');
  addGeometryPrimitive(doc, legMesh, new BoxGeometry(0.16, 0.72, 0.18).translate(0, -0.36, 0), boots);

  const root = doc.createNode('root');
  root.addChild(doc.createNode('body').setMesh(body));
  const hips = [-0.14, 0.14].map((x, i) => {
    const hip = doc.createNode(i === 0 ? 'hip-l' : 'hip-r').setTranslation([x, 0.74, 0]);
    hip.addChild(doc.createNode(i === 0 ? 'leg-l' : 'leg-r').setMesh(legMesh));
    root.addChild(hip);
    return hip;
  });
  doc.createScene('walker').addChild(root);

  const buffer = doc.getRoot().listBuffers()[0] ?? null;
  const keys = Array.from({ length: 9 }, (_, k) => k / 8);
  const accessor = (name: string, type: 'SCALAR' | 'VEC3' | 'VEC4', values: number[]) =>
    doc.createAccessor(name).setType(type).setBuffer(buffer).setArray(new Float32Array(values));
  const times = accessor('times', 'SCALAR', keys);
  const swing = (sign: number) =>
    keys.flatMap((t) =>
      new Quaternion()
        .setFromEuler(new Euler(sign * ((25 * Math.PI) / 180) * Math.sin(2 * Math.PI * t), 0, 0))
        .toArray(),
    );
  const bob = (shift: (k: number) => number) =>
    keys.flatMap((t, k) => [shift(k), 0.04 * Math.abs(Math.sin(2 * Math.PI * t)), 0]);
  const clip = (
    name: string,
    channels: {
      node: Node;
      path: 'rotation' | 'translation';
      values: number[];
      type: 'VEC3' | 'VEC4';
      step?: boolean;
    }[],
  ) => {
    const animation = doc.createAnimation(name);
    for (const c of channels) {
      const sampler = doc
        .createAnimationSampler()
        .setInput(times)
        .setOutput(accessor(`${name}-${c.node.getName()}-${c.path}`, c.type, c.values))
        .setInterpolation(c.step ? 'STEP' : 'LINEAR');
      animation
        .addSampler(sampler)
        .addChannel(doc.createAnimationChannel().setTargetNode(c.node).setTargetPath(c.path).setSampler(sampler));
    }
  };
  const [left, right] = hips as [Node, Node];
  const legs = [
    { node: left, path: 'rotation' as const, type: 'VEC4' as const, values: swing(1) },
    { node: right, path: 'rotation' as const, type: 'VEC4' as const, values: swing(-1) },
  ];
  clip('walk', [...legs, { node: root, path: 'translation', type: 'VEC3', values: bob(() => 0) }]);
  clip('turn', [
    {
      node: root,
      path: 'rotation',
      type: 'VEC4',
      values: keys.flatMap((t) => new Quaternion().setFromEuler(new Euler(0, 2 * Math.PI * t, 0)).toArray()),
    },
  ]);
  const slide = options.slide ?? 1 / 16;
  clip('slide', [{ node: root, path: 'translation', type: 'VEC3', values: keys.flatMap((t) => [slide * t, 0, 0]) }]);
  const shift = options.jitterShift;
  if (shift !== undefined) {
    clip('jitter', [
      ...legs,
      { node: root, path: 'translation', type: 'VEC3', step: true, values: bob((k) => (k % 2 === 1 ? shift : 0)) },
    ]);
  }
  return writeGlb(doc);
}

/** A sword standing on its pommel: 25 cm grip, 30 cm guard and a 1 m blade 5 cm wide and 2 cm thick. */
export async function swordGlb(): Promise<Uint8Array> {
  const doc = newDocument();
  const steel = addTd2dMaterial(doc, toon('steel', '#c2c3c7'));
  const leather = addTd2dMaterial(doc, toon('leather', '#8a5a3b', 2));
  const mesh = doc.createMesh('sword');
  addGeometryPrimitive(doc, mesh, new CylinderGeometry(0.02, 0.02, 0.25, 8).translate(0, 0.125, 0), leather);
  addGeometryPrimitive(doc, mesh, new BoxGeometry(0.3, 0.04, 0.05).translate(0, 0.27, 0), steel);
  addGeometryPrimitive(doc, mesh, new BoxGeometry(0.05, 1, 0.02).translate(0, 0.79, 0), steel);
  doc.createScene('sword').addChild(doc.createNode('sword').setMesh(mesh));
  return writeGlb(doc);
}
