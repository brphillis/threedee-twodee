import type { BoneDefinitionT, ClipDefinitionT, IssueT, ResolvedRigT, RigDefinitionT, WarningT } from '@td2d/schema';
import type { Library } from '../project/library.ts';
import { checkGenerator, MODEL_ROOT } from './generators.ts';

export interface RigLayer {
  readonly file: string | undefined;
  /** Path of the layer's rig value, such as "rig" or "typeDefaults.character.rig". */
  readonly path: string;
  readonly value: string | RigDefinitionT;
}

interface Working {
  parent: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
  limits: BoneDefinitionT['limits'] | null;
  /** Where the bone was last defined, for messages. */
  file: string | undefined;
  path: string;
}

/**
 * Combine rig values from every settings layer. A preset (by name or `preset`) starts the rig
 * again from that preset's bones; `scale` multiplies every bone position defined so far;
 * `bones` change bones by name or add new ones. Returns null when there are no bones.
 */
export function resolveRig(
  layers: readonly RigLayer[],
  library: Pick<Library, 'rigs'>,
  issues: IssueT[],
): ResolvedRigT | null {
  let preset: string | null = null;
  let bones = new Map<string, Working>();
  const push = (layer: RigLayer, path: string, message: string, code: string) =>
    issues.push({ ...(layer.file ? { file: layer.file } : {}), path, message, code });

  for (const layer of layers) {
    const value = typeof layer.value === 'string' ? { preset: layer.value } : layer.value;
    if (value.preset !== undefined) {
      const entry = library.rigs.get(value.preset);
      const where = typeof layer.value === 'string' ? layer.path : `${layer.path}.preset`;
      if (!entry) {
        push(
          layer,
          where,
          `Rig preset "${value.preset}" does not exist. Presets: ${[...library.rigs.keys()].join(', ')}`,
          'preset_not_found',
        );
        continue;
      }
      preset = value.preset;
      bones = new Map();
      for (const b of entry.data.bones) {
        bones.set(b.name, {
          parent: b.parent ?? null,
          position: [...(b.position ?? [0, 0, 0])],
          rotation: [...(b.rotation ?? [0, 0, 0])],
          limits: b.limits ?? null,
          file: entry.file,
          path: 'bones',
        });
      }
    }
    if (value.scale !== undefined) {
      const k = value.scale;
      for (const b of bones.values()) b.position = [b.position[0] * k, b.position[1] * k, b.position[2] * k];
    }
    for (const [i, def] of (value.bones ?? []).entries()) {
      const path = `${layer.path}.bones[${i}]`;
      const existing = bones.get(def.name);
      if (existing) {
        if (def.parent !== undefined) existing.parent = def.parent;
        if (def.position) existing.position = [...def.position];
        if (def.rotation) existing.rotation = [...def.rotation];
        if (def.limits) existing.limits = def.limits;
        existing.file = layer.file;
        existing.path = path;
      } else {
        if (def.parent === undefined) {
          push(
            layer,
            `${path}.parent`,
            `Bone "${def.name}" is new, so it needs a parent (or null for the root)`,
            'missing_parent',
          );
          continue;
        }
        bones.set(def.name, {
          parent: def.parent,
          position: [...(def.position ?? [0, 0, 0])],
          rotation: [...(def.rotation ?? [0, 0, 0])],
          limits: def.limits ?? null,
          file: layer.file,
          path,
        });
      }
    }
  }
  if (bones.size === 0) return null;

  const at = (b: Working) => ({ ...(b.file ? { file: b.file } : {}), path: b.path });
  let ok = true;
  const roots = [...bones].filter(([, b]) => b.parent === null);
  if (roots.length !== 1) {
    const first = bones.values().next().value as Working;
    issues.push({
      ...at(first),
      message:
        roots.length === 0
          ? 'The rig has no root bone; give one bone "parent": null'
          : `The rig has ${roots.length} root bones (${roots.map(([n]) => n).join(', ')}); it needs exactly one`,
      code: 'invalid_rig',
    });
    ok = false;
  }
  for (const [name, b] of bones) {
    if (b.parent !== null && !bones.has(b.parent)) {
      issues.push({
        ...at(b),
        path: `${b.path}.parent`,
        message: `Bone "${name}" has parent "${b.parent}", which is not in the rig`,
        code: 'unknown_bone',
      });
      ok = false;
    }
  }
  if (!ok) return null;
  // Order parents before children, keeping definition order otherwise; anything left is a cycle.
  const ordered: string[] = [];
  const placed = new Set<string>();
  let progress = true;
  while (ordered.length < bones.size && progress) {
    progress = false;
    for (const [name, b] of bones) {
      if (placed.has(name) || (b.parent !== null && !placed.has(b.parent))) continue;
      ordered.push(name);
      placed.add(name);
      progress = true;
    }
  }
  if (ordered.length < bones.size) {
    const cyclic = [...bones.keys()].filter((n) => !placed.has(n));
    issues.push({
      ...at(bones.get(cyclic[0] as string) as Working),
      message: `Bones ${cyclic.join(', ')} form a parent cycle`,
      code: 'invalid_rig',
    });
    return null;
  }
  return {
    preset,
    bones: ordered.map((name) => {
      const b = bones.get(name) as Working;
      return { name, parent: b.parent, position: b.position, rotation: b.rotation, limits: b.limits ?? null };
    }),
  };
}

/** Bone names a pose may use: the rig's bones, or "root" (the whole model) without a rig. */
export function poseBones(rig: ResolvedRigT | null): Set<string> {
  return new Set(rig ? rig.bones.map((b) => b.name) : [MODEL_ROOT]);
}

/**
 * Check a clip's keys, generator and sample times against the rig. Problems become issues;
 * a duration that is not a whole number of frames is a warning.
 */
export function checkClip(
  name: string,
  clip: ClipDefinitionT,
  fps: number,
  rig: ResolvedRigT | null,
  file: string,
  issues: IssueT[],
  warnings: WarningT[],
  assetId: string,
): void {
  const base = `animation.clips.${name}`;
  const allowed = poseBones(rig);
  const listed = rig ? `Bones: ${[...allowed].join(', ')}` : 'Without a rig the only bone is "root", the whole model';
  let previous = -1;
  for (const [i, key] of (clip.keys ?? []).entries()) {
    const path = `${base}.keys[${i}]`;
    if (key.t > clip.duration + 1e-9)
      issues.push({
        file,
        path: `${path}.t`,
        message: `Key time ${key.t} s is after the end of the ${clip.duration} s clip`,
        code: 'too_big',
      });
    if (key.t <= previous)
      issues.push({ file, path: `${path}.t`, message: 'Key times must increase', code: 'unsorted_keys' });
    previous = key.t;
    for (const bone of Object.keys(key.pose)) {
      if (!allowed.has(bone))
        issues.push({
          file,
          path: `${path}.pose.${bone}`,
          message: `Bone "${bone}" is not in the rig. ${listed}`,
          code: 'unknown_bone',
        });
    }
  }
  if (clip.generator) {
    for (const p of checkGenerator(clip.generator, rig))
      issues.push({ file, path: `${base}.generator.${p.path}`, message: p.message, code: 'unknown_bone' });
  }
  let last = -1;
  for (const [i, t] of (clip.sampleTimes ?? []).entries()) {
    const path = `${base}.sampleTimes[${i}]`;
    if (t > clip.duration + 1e-9)
      issues.push({
        file,
        path,
        message: `Sample time ${t} s is after the end of the ${clip.duration} s clip`,
        code: 'too_big',
      });
    if (t <= last) issues.push({ file, path, message: 'Sample times must increase', code: 'unsorted_keys' });
    last = t;
  }
  const clipFps = clip.fps ?? fps;
  const frames = clip.duration * clipFps;
  if (!clip.sampleTimes && Math.abs(frames - Math.round(frames)) > 1e-6) {
    warnings.push({
      code: 'W_CLIP_FRAME_PERIOD',
      message: `Clip "${name}" lasts ${clip.duration} s, which is ${Number(frames.toFixed(3))} frames at ${clipFps} fps. It renders ${Math.max(1, Math.round(frames))} frames, so it plays at ${Number((Math.max(1, Math.round(frames)) / clip.duration).toFixed(3))} fps instead.`,
      file,
      path: `${base}.duration`,
      assetId,
      hint: `Use a duration that is a multiple of ${Number((1 / clipFps).toFixed(4))} s, such as ${Number((Math.max(1, Math.round(frames)) / clipFps).toFixed(4))}.`,
    });
  }
}
