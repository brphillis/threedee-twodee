import type { LightingSettingsT } from './documents/lighting.ts';
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

/** sRGB #rrggbb to linear channels, as three.js converts light and material colours. */
export function hexToLinearRgb(hex: string): Point3 {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

/** Luminance of linear RGB, with the weights the three.js shaders use. */
export function linearLuminance([r, g, b]: Point3): number {
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

/**
 * How much light a white toon-shaded surface receives, in the units the shaders add up:
 * `floor` from the ambient and hemisphere lights alone, which is all a face turned from every
 * light or in shadow gets, and `ceil` with the strongest directional light fully on as well.
 * A toon band k of n lands at floor + (ceil - floor) * k / (n - 1), so these two numbers turn
 * the light on a pixel into a band, which is how a material's ramp picks its colour.
 */
export function lightLevels(lighting: Pick<LightingSettingsT, 'lights'>): { floor: number; ceil: number } {
  let floor = 0;
  let strongest = 0;
  for (const light of lighting.lights) {
    if (light.type === 'ambient') {
      floor += (light.intensity * linearLuminance(hexToLinearRgb(light.color ?? '#ffffff'))) / Math.PI;
    } else if (light.type === 'hemisphere') {
      const sky = hexToLinearRgb(light.skyColor);
      const ground = hexToLinearRgb(light.groundColor);
      floor +=
        (light.intensity *
          linearLuminance([0, 1, 2].map((i) => ((sky[i] as number) + (ground[i] as number)) / 2) as Point3)) /
        Math.PI;
    } else {
      strongest = Math.max(
        strongest,
        (light.intensity * linearLuminance(hexToLinearRgb(light.color ?? '#ffffff'))) / Math.PI,
      );
    }
  }
  return { floor, ceil: floor + strongest };
}
