import type { LightingSettingsT } from './documents/lighting.ts';

/**
 * Contract between the Node render backend and the browser harness.
 * Plain types only: the harness imports them with `import type`, so no runtime code crosses over.
 */

/** A material applied by name at render time, so colour changes never require rebuilding geometry. */
export interface RenderMaterial {
  /** sRGB #rrggbb. */
  readonly color: string;
  readonly shading: 'toon' | 'flat' | 'lambert';
  readonly bands: number;
  /** sRGB #rrggbb. */
  readonly emissive: string;
}

/** Settings shared by every sample in a render job. */
export interface RenderSceneSettings {
  /** Final sprite size in pixels. The render is this size times `supersample`. */
  readonly frame: { readonly width: number; readonly height: number };
  readonly supersample: number;
  readonly pixelsPerUnit: number;
  readonly camera: { readonly pitch: number; readonly yawOffset: number; readonly groundMargin: number };
  readonly lighting: LightingSettingsT;
  /** Materials by glTF material name. Materials not listed keep what the GLB carries. */
  readonly materials?: Readonly<Record<string, RenderMaterial>>;
  /** Lines around every part, or absent for none. */
  readonly lines?: RenderLinesSettings;
}

/**
 * Lines the harness draws in screen space: on the nearer side of every step in depth and of
 * every boundary between two lined materials.
 */
export interface RenderLinesSettings {
  /** Width in final sprite pixels. */
  readonly width: number;
  /** sRGB #rrggbb for every line, or null for a shade of each part's own colour. */
  readonly color: string | null;
  /** With color null, the line's brightness as a share of the part's colour. */
  readonly shade: number;
  /** The smallest step in depth that is lined, in metres. */
  readonly depth: number;
  /** Materials that draw no lines. */
  readonly skip: readonly string[];
}

/** One frame to render: a direction yaw and, for animated models, a clip time. */
export interface FrameSample {
  /** Stable key such as "idle/s/000". */
  readonly key: string;
  /** Clip name, or null to render the rest pose. */
  readonly clip: string | null;
  /** Seconds into the clip. Ignored for the rest pose. */
  readonly time: number;
  /** Direction yaw in degrees, before the camera yaw offset. */
  readonly yaw: number;
}

/** A rendered frame as it crosses the browser boundary: RGBA rows bottom-up, base64 encoded. */
export interface EncodedFrame {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly rgbaBase64: string;
}

export interface HarnessCapabilities {
  readonly harnessVersion: string;
  readonly threeRevision: string;
  readonly webgl2: boolean;
  readonly renderer: string;
  readonly vendor: string;
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
}

export interface ModelInfo {
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  /** Largest distance from the origin to a corner of the bounds, in metres. */
  readonly radius: number;
  readonly meshes: number;
  readonly triangles: number;
  readonly skinned: boolean;
  readonly materials: readonly string[];
  readonly clips: readonly { readonly name: string; readonly duration: number }[];
}

/** The API the harness page exposes as `window.__td2d`. */
export interface HarnessApi {
  readonly ready: boolean;
  capabilities(): HarnessCapabilities;
  loadModel(glbBase64: string): Promise<ModelInfo>;
  configure(settings: RenderSceneSettings): void;
  renderSamples(samples: readonly FrameSample[]): EncodedFrame[];
}

/** Bump when the harness API changes so a stale bundle is detected. */
export const HARNESS_PROTOCOL_VERSION = 3;
