import type {
  AssetDefaultsT,
  AssetTypeT,
  CameraSettingsT,
  ExportSettingsT,
  LightingSettingsT,
  PixelSettingsT,
  SheetSettingsT,
} from '@td2d/schema';

/** Values every preset kind starts from before any preset or override is applied. */
export const BASE_SETTINGS: {
  readonly camera: CameraSettingsT;
  readonly lighting: LightingSettingsT;
  readonly pixel: PixelSettingsT;
  readonly sheet: SheetSettingsT;
  readonly export: ExportSettingsT;
} = {
  camera: { projection: 'orthographic', pitch: 30, yawOffset: 45, groundMargin: 'auto' },
  lighting: {
    space: 'camera',
    lights: [
      { type: 'directional', azimuth: -35, elevation: 55, intensity: 1.7279, color: '#ffffff', castShadow: true },
      { type: 'ambient', intensity: 1.4137, color: '#ffffff' },
    ],
    shadows: { enabled: true, mapSize: 1024, bias: -0.0005, normalBias: 0.02 },
    groundShadow: { enabled: false, color: '#1a1c2c' },
  },
  pixel: {
    downscale: 'mode',
    alphaThreshold: 128,
    bleed: true,
    posterize: 'none',
    palette: 'none',
    paletteScope: 'asset',
    dither: 'none',
    ditherStrength: 0.5,
    outline: 'none',
    cleanup: { orphans: 'off', minNeighbours: 1 },
  },
  sheet: {
    layout: 'grid',
    order: 'clip-direction',
    flow: 'rows',
    split: 'none',
    trim: false,
    padding: 0,
    extrude: 0,
    powerOfTwo: false,
    maxSize: 4096,
  },
  export: {
    formats: ['aseprite-json', 'manifest'],
    png: { indexed: 'auto', compressionLevel: 9 },
    aseprite: { variant: 'hash', frameNames: 'index' },
    godot: { directory: 'res://' },
    gif: { scale: 2, background: 'transparent' },
  },
};

/** Built-in defaults shared by every asset type. */
export const BUILTIN_DEFAULTS: AssetDefaultsT = {
  frame: { width: 32, height: 32 },
  pixelsPerUnit: 16,
  camera: 'dimetric',
  lighting: 'studio-toon',
  directions: 'd4',
  mirror: [],
  render: { supersample: 4, backend: 'playwright-swiftshader' },
  pixel: 'default',
  sheet: 'grid',
  export: 'default',
  fps: 10,
};

/** Built-in defaults per asset type, applied after BUILTIN_DEFAULTS. */
export const BUILTIN_TYPE_DEFAULTS: Readonly<Record<AssetTypeT, AssetDefaultsT>> = {
  prop: {},
  character: { frame: { width: 32, height: 48 }, directions: 'd8' },
  tile: { frame: { width: 64, height: 32 }, directions: 'd1' },
  effect: { directions: 'd1', lighting: 'flat' },
};

export const MATERIAL_DEFAULTS = {
  shading: 'toon',
  bands: 3,
  emissive: '#000000',
  outline: true,
  opacity: 1,
} as const;
