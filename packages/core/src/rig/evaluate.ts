import type { Animation, Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

type Path = 'translation' | 'rotation' | 'scale';

interface LocalTrs {
  t: Vector3;
  r: Quaternion;
  s: Vector3;
}

function restTrs(node: Node): LocalTrs {
  return {
    t: new Vector3(...node.getTranslation()),
    r: new Quaternion(...node.getRotation()),
    s: new Vector3(...node.getScale()),
  };
}

/** Value of one animation channel at time t, following the sampler's interpolation. */
function sampleChannel(
  input: Float32Array | number[],
  output: Float32Array | number[],
  interpolation: string,
  path: Path,
  t: number,
): number[] {
  const width = path === 'rotation' ? 4 : 3;
  const stride = interpolation === 'CUBICSPLINE' ? width * 3 : width;
  const offset = interpolation === 'CUBICSPLINE' ? width : 0;
  const at = (i: number) => Array.from(output.slice(i * stride + offset, i * stride + offset + width));
  const n = input.length;
  if (n === 0) return [];
  if (t <= (input[0] as number)) return at(0);
  if (t >= (input[n - 1] as number)) return at(n - 1);
  let i = 0;
  while (i < n - 2 && t >= (input[i + 1] as number)) i++;
  if (interpolation === 'STEP') return at(i);
  const t0 = input[i] as number;
  const t1 = input[i + 1] as number;
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = at(i);
  const b = at(i + 1);
  if (path === 'rotation') {
    const q = new Quaternion(...(a as [number, number, number, number])).slerp(
      new Quaternion(...(b as [number, number, number, number])),
      u,
    );
    return [q.x, q.y, q.z, q.w];
  }
  return a.map((v, k) => v + ((b[k] as number) - v) * u);
}

/** Local transforms of every node, with an animation applied at time t when given. */
function localTransforms(doc: Document, animation: Animation | null, t: number): Map<Node, LocalTrs> {
  const locals = new Map<Node, LocalTrs>();
  for (const node of doc.getRoot().listNodes()) locals.set(node, restTrs(node));
  if (animation) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      const sampler = channel.getSampler();
      const path = channel.getTargetPath() as Path | 'weights';
      const input = sampler?.getInput()?.getArray();
      const output = sampler?.getOutput()?.getArray();
      if (!node || !sampler || !input || !output || path === 'weights') continue;
      const value = sampleChannel(input as Float32Array, output as Float32Array, sampler.getInterpolation(), path, t);
      const trs = locals.get(node) as LocalTrs;
      if (path === 'translation') trs.t.set(value[0] as number, value[1] as number, value[2] as number);
      else if (path === 'scale') trs.s.set(value[0] as number, value[1] as number, value[2] as number);
      else trs.r.set(value[0] as number, value[1] as number, value[2] as number, value[3] as number).normalize();
    }
  }
  return locals;
}

function worldMatrices(doc: Document, locals: Map<Node, LocalTrs>): Map<Node, Matrix4> {
  const world = new Map<Node, Matrix4>();
  const visit = (node: Node, parent: Matrix4) => {
    const trs = locals.get(node) as LocalTrs;
    const m = parent.clone().multiply(new Matrix4().compose(trs.t, trs.r, trs.s));
    world.set(node, m);
    for (const child of node.listChildren()) visit(child, m);
  };
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const node of scene?.listChildren() ?? []) visit(node, new Matrix4());
  return world;
}

/**
 * Vertex positions of every mesh node, posed by an animation at time t (or at rest when
 * animation is null), by node name. Skinned meshes are skinned on the CPU the way glTF
 * defines it: the node transform is ignored and each vertex blends its joints.
 */
export function posedPositionsByNode(
  doc: Document,
  animationName: string | null,
  t: number,
): Map<string, Float64Array> {
  const animation =
    animationName === null
      ? null
      : (doc
          .getRoot()
          .listAnimations()
          .find((a) => a.getName() === animationName) ?? null);
  const world = worldMatrices(doc, localTransforms(doc, animation, t));
  const out = new Map<string, Float64Array>();
  const p = [0, 0, 0];
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  const v = new Vector3();
  const acc = new Vector3();
  const tmp = new Vector3();
  for (const [node, matrix] of world) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    let jointMatrices: Matrix4[] | null = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices()?.getArray();
      jointMatrices = skin.listJoints().map((joint, k) => {
        const inverse = ibm ? new Matrix4().fromArray(Array.from(ibm.slice(k * 16, k * 16 + 16))) : new Matrix4();
        return (world.get(joint) ?? new Matrix4()).clone().multiply(inverse);
      });
    }
    const values: number[] = [];
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const joints = primitive.getAttribute('JOINTS_0');
      const weights = primitive.getAttribute('WEIGHTS_0');
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        v.set(p[0] as number, p[1] as number, p[2] as number);
        if (jointMatrices && joints && weights) {
          joints.getElement(i, j);
          weights.getElement(i, w);
          acc.set(0, 0, 0);
          for (let k = 0; k < 4; k++) {
            const weight = w[k] as number;
            if (weight === 0) continue;
            tmp
              .copy(v)
              .applyMatrix4(jointMatrices[j[k] as number] as Matrix4)
              .multiplyScalar(weight);
            acc.add(tmp);
          }
          values.push(acc.x, acc.y, acc.z);
        } else {
          tmp.copy(v).applyMatrix4(matrix);
          values.push(tmp.x, tmp.y, tmp.z);
        }
      }
    }
    const name = node.getName();
    const previous = out.get(name);
    out.set(name, previous ? Float64Array.from([...previous, ...values]) : Float64Array.from(values));
  }
  return out;
}

/** Every posed vertex position, in one flat [x, y, z, ...] array. */
export function posedPositions(doc: Document, animationName: string | null, t: number): Float64Array {
  const parts = [...posedPositionsByNode(doc, animationName, t).values()];
  const out = new Float64Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
