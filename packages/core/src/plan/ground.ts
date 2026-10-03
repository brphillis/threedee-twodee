import type { Document } from '@gltf-transform/core';
import type { RenderSceneSettings } from '@td2d/schema';
import { cameraRig, projectToPixels } from '@td2d/schema/camera';

const NO_LIGHTS: RenderSceneSettings['lighting'] = {
  space: 'camera',
  lights: [],
  shadows: { enabled: false, mapSize: 256, bias: 0, normalBias: 0 },
};

/** World-space vertex positions of every mesh in the default scene, as a flat [x, y, z, ...] array. */
export function worldPositions(doc: Document): Float64Array {
  const out: number[] = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  scene?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const p = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        const [x = 0, y = 0, z = 0] = p;
        out.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
      }
    }
  });
  return Float64Array.from(out);
}

/** Largest distance from the origin to a vertex, used to size the camera and shadow volumes. */
export function boundingRadius(positions: Float64Array): number {
  let r = 0;
  for (let i = 0; i < positions.length; i += 3)
    r = Math.max(r, Math.hypot(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0));
  return r;
}

/**
 * The smallest ground margin, in final pixels, that keeps every vertex at least one
 * pixel above the bottom edge in every direction. Geometry in front of the pivot
 * projects below the pivot line by its depth times sin(pitch), so the margin depends
 * on the footprint. The same margin is used for every direction so the pivot never moves.
 * `pad` reserves extra pixels for what the pixel stage adds around the silhouette, such as
 * an outside outline.
 */
export function autoGroundMargin(
  positions: Float64Array,
  yaws: readonly number[],
  scene: Pick<RenderSceneSettings, 'frame' | 'supersample' | 'pixelsPerUnit'> & {
    camera: { pitch: number; yawOffset: number };
  },
  pad = 0,
): number {
  let below = 0;
  for (const yaw of yaws) {
    const { up } = cameraRig({ ...scene, lighting: NO_LIGHTS, camera: { ...scene.camera, groundMargin: 0 } }, yaw, 1);
    for (let i = 0; i < positions.length; i += 3) {
      const height = (positions[i] ?? 0) * up[0] + (positions[i + 1] ?? 0) * up[1] + (positions[i + 2] ?? 0) * up[2];
      if (-height > below) below = -height;
    }
  }
  return Math.ceil(below * scene.pixelsPerUnit - 1e-6) + 1 + pad;
}

export interface FrameFit {
  readonly direction: string;
  /** Projected extent in final pixels, with x to the right and y down from the top edge. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Where the model lands in the final frame for each direction. */
export function frameFit(
  positions: Float64Array,
  directions: readonly { name: string; yaw: number }[],
  scene: Pick<RenderSceneSettings, 'frame' | 'supersample' | 'pixelsPerUnit'> & {
    camera: { pitch: number; yawOffset: number; groundMargin: number };
  },
): FrameFit[] {
  return directions.map((d) => {
    const rig = cameraRig({ ...scene, lighting: NO_LIGHTS }, d.yaw, 1);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < positions.length; i += 3) {
      const p = projectToPixels(rig, [positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0]);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const s = scene.supersample;
    return { direction: d.name, minX: minX / s, maxX: maxX / s, minY: minY / s, maxY: maxY / s };
  });
}

/**
 * The largest whole pixelsPerUnit at which the model fits the frame in every direction:
 * one pixel clear of the left, right and top edges, and clear of the bottom edge by the
 * ground margin (fitted automatically when it is "auto"). `pad` adds that many more pixels of
 * clearance on every side, for an outside outline. Returns at least 1.
 */
export function autoPixelsPerUnit(
  positions: Float64Array,
  yaws: readonly number[],
  scene: Pick<RenderSceneSettings, 'frame' | 'supersample'> & {
    camera: { pitch: number; yawOffset: number; groundMargin: number | 'auto' };
  },
  pad = 0,
): number {
  let halfWidth = 0;
  let above = 0;
  let below = 0;
  for (const yaw of yaws) {
    const { right, up } = cameraRig(
      { ...scene, pixelsPerUnit: 1, lighting: NO_LIGHTS, camera: { ...scene.camera, groundMargin: 0 } },
      yaw,
      1,
    );
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0] as const;
      const x = p[0] * right[0] + p[1] * right[1] + p[2] * right[2];
      const y = p[0] * up[0] + p[1] * up[1] + p[2] * up[2];
      halfWidth = Math.max(halfWidth, Math.abs(x));
      above = Math.max(above, y);
      below = Math.max(below, -y);
    }
  }
  const { width, height } = scene.frame;
  const margin = scene.camera.groundMargin;
  const fits = (ppu: number) => {
    const ground = margin === 'auto' ? Math.ceil(below * ppu - 1e-6) + 1 + pad : margin;
    return (
      halfWidth * ppu <= width / 2 - 1 - pad + 1e-9 &&
      above * ppu <= height - ground - 1 - pad + 1e-9 &&
      (margin === 'auto' || below * ppu <= margin - 1 - pad + 1e-9)
    );
  };
  const bounds = [
    halfWidth > 0 ? (width / 2 - 1 - pad) / halfWidth : 1024,
    above + below > 0 ? (height - 2 - 2 * pad) / (above + below) : 1024,
  ];
  let ppu = Math.max(1, Math.min(1024, Math.floor(Math.min(...bounds))));
  while (ppu > 1 && !fits(ppu)) ppu--;
  return ppu;
}
