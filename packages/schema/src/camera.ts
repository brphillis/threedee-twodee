import type { RenderSceneSettings } from './render.ts';

export type Point3 = [number, number, number];

const DEG = Math.PI / 180;

export interface CameraRig {
  /** Camera position. The camera always looks at the asset pivot, the world origin. */
  readonly position: Point3;
  /** Camera up vector, exact for every pitch including straight down. */
  readonly up: Point3;
  /** Camera right vector. */
  readonly right: Point3;
  /** Unit vector from the pivot towards the camera. */
  readonly toCamera: Point3;
  /** Orthographic frustum in metres on the view plane, relative to the pivot. */
  readonly frustum: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly near: number;
    readonly far: number;
  };
  readonly renderWidth: number;
  readonly renderHeight: number;
  /** Camera azimuth in degrees: direction yaw plus the camera yaw offset. */
  readonly azimuth: number;
}

/** Unit vector at an azimuth (degrees, 0 is +Z, increasing towards +X) and an elevation above the horizon. */
export function directionVector(azimuthDeg: number, elevationDeg: number): Point3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/**
 * Orthographic camera for one direction.
 *
 * The pivot (world origin) projects to the horizontal centre of the frame and to the
 * line `groundMargin` pixels above the bottom edge. Both are exact pixel boundaries,
 * so every final pixel covers exactly `supersample` x `supersample` render pixels and
 * the pivot never drifts between frames or directions.
 */
export function cameraRig(settings: RenderSceneSettings, yaw: number, modelRadius: number): CameraRig {
  const { frame, supersample, pixelsPerUnit, camera } = settings;
  const width = frame.width / pixelsPerUnit;
  const height = frame.height / pixelsPerUnit;
  const ground = camera.groundMargin / pixelsPerUnit;
  const azimuth = yaw + camera.yawOffset;
  const az = azimuth * DEG;
  const el = camera.pitch * DEG;
  const toCamera = directionVector(azimuth, camera.pitch);
  const radius = Math.max(modelRadius, 0.5);
  const distance = radius * 2 + Math.max(width, height) + 10;
  return {
    position: [toCamera[0] * distance, toCamera[1] * distance, toCamera[2] * distance],
    up: [-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)],
    right: [Math.cos(az), 0, -Math.sin(az)],
    toCamera,
    frustum: {
      left: -width / 2,
      right: width / 2,
      top: height - ground,
      bottom: -ground,
      near: 0.01,
      far: distance + radius * 2 + 1,
    },
    renderWidth: frame.width * supersample,
    renderHeight: frame.height * supersample,
    azimuth,
  };
}

/** Project a world point to render-pixel coordinates (x right, y down from the top edge). */
export function projectToPixels(rig: CameraRig, p: Point3): { x: number; y: number } {
  const sx = p[0] * rig.right[0] + p[1] * rig.right[1] + p[2] * rig.right[2];
  const sy = p[0] * rig.up[0] + p[1] * rig.up[1] + p[2] * rig.up[2];
  const { left, right, top, bottom } = rig.frustum;
  return {
    x: ((sx - left) / (right - left)) * rig.renderWidth,
    y: ((top - sy) / (top - bottom)) * rig.renderHeight,
  };
}

/** Direction from the pivot towards a light. Camera-space lights turn with the camera. */
export function lightDirection(
  light: { azimuth: number; elevation: number },
  space: 'camera' | 'world',
  cameraAzimuth: number,
): Point3 {
  return directionVector(space === 'camera' ? cameraAzimuth + light.azimuth : light.azimuth, light.elevation);
}
