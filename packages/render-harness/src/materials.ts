import type { RenderMaterial } from '@td2d/schema';
import type { lightLevels } from '@td2d/schema/camera';
import {
  Color,
  DataTexture,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshToonMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
} from 'three';

export interface Td2dMaterialExtras {
  readonly shading?: 'toon' | 'flat' | 'lambert';
  readonly bands?: number;
  readonly outline?: boolean;
}

const gradients = new Map<number, DataTexture>();

/**
 * A `bands`-step lighting ramp for MeshToonMaterial. three.js samples the ramp at
 * dot(N, L) * 0.5 + 0.5, so faces turned away from a light read the left half. The left
 * half is therefore all 0 (ambient only) and the bands are spread over the lit half,
 * dot(N, L) from 0 to 1, rising from 0 to full strength. Nearest filtering keeps them hard.
 */
export function toonGradient(bands: number): DataTexture {
  const existing = gradients.get(bands);
  if (existing) return existing;
  const data = new Uint8Array(bands * 2);
  for (let i = 0; i < bands; i++) data[bands + i] = Math.round((255 * i) / (bands - 1));
  const texture = new DataTexture(data, bands * 2, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  gradients.set(bands, texture);
  return texture;
}

/** The light a white surface gets from the ambient lights alone and with the key light fully on. */
export type LightLevels = ReturnType<typeof lightLevels>;

/**
 * Build a td2d material from an explicit render material. A material with a ramp needs the
 * scene's light levels to turn the light on a pixel into one of the ramp's colours.
 */
export function materialFromSpec(
  name: string,
  spec: RenderMaterial,
  vertexColors = false,
  levels: LightLevels = { floor: 0, ceil: 1 },
): Material {
  if (spec.ramp && spec.shading === 'toon')
    return rampMaterial(name, new Color(spec.color), new Color(spec.emissive), spec.ramp, levels);
  return td2dMaterial({
    name,
    color: new Color(spec.color),
    emissive: new Color(spec.emissive),
    vertexColors,
    userData: { td2d: { shading: spec.shading, bands: spec.bands } },
  });
}

/** The most colours a ramp may hold; the shader's uniform array is this long. */
export const RAMP_MAX = 8;

/**
 * Toon shading that paints each light level with one of the ramp's colours instead of a shade of
 * `color`. The usual toon lighting is computed for a white surface, so its brightness is the
 * light alone; the shader then turns that brightness into a band with the scene's light levels
 * (band k of n lies at floor + (ceil - floor) * k / (n - 1)) and writes the ramp colour of that
 * band, plus any emissive colour. `color` stays on the material for the line pass and viewers.
 */
export function rampMaterial(
  name: string,
  color: Color,
  emissive: Color,
  ramp: readonly string[],
  levels: LightLevels,
): MeshToonMaterial {
  const count = Math.min(RAMP_MAX, Math.max(2, ramp.length));
  const material = new MeshToonMaterial({ name, color, emissive, gradientMap: toonGradient(count) });
  const colours = Array.from({ length: RAMP_MAX }, (_, i) => new Color(ramp[Math.min(i, ramp.length - 1)]));
  const scale = levels.ceil > levels.floor + 1e-6 ? (count - 1) / (levels.ceil - levels.floor) : 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rampColours = { value: colours };
    shader.uniforms.rampCount = { value: count };
    shader.uniforms.rampFloor = { value: levels.floor };
    shader.uniforms.rampScale = { value: scale };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${RAMP_UNIFORMS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb = vec3(1.0);')
      .replace('#include <opaque_fragment>', `${RAMP_FRAGMENT}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'td2d-ramp';
  material.userData = { td2d: { shading: 'toon', bands: count, ramp: [...ramp] } };
  return material;
}

const RAMP_UNIFORMS = /* glsl */ `
  uniform vec3 rampColours[${RAMP_MAX}];
  uniform int rampCount;
  uniform float rampFloor;
  uniform float rampScale;
`;

const RAMP_FRAGMENT = /* glsl */ `
  float rampLit = luminance(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse);
  float rampBand = rampScale > 0.0 ? floor((rampLit - rampFloor) * rampScale + 0.5) : float(rampCount - 1);
  int rampIndex = int(clamp(rampBand, 0.0, float(rampCount - 1)));
  outgoingLight = rampColours[rampIndex] + totalEmissiveRadiance;
`;

interface SourceMaterial {
  name: string;
  color?: Color;
  emissive?: Color;
  vertexColors?: boolean;
  userData: Record<string, unknown>;
}

/** Replace a loaded glTF material with the td2d material its extras ask for. */
export function td2dMaterial(source: SourceMaterial): Material {
  const extras = (source.userData.td2d ?? {}) as Td2dMaterialExtras;
  const common = { name: source.name, vertexColors: source.vertexColors ?? false };
  const color = source.color?.clone();
  const emissive = source.emissive?.clone();
  switch (extras.shading ?? 'toon') {
    case 'flat':
      return new MeshBasicMaterial({ ...common, ...(color ? { color } : {}) });
    case 'lambert':
      return new MeshLambertMaterial({ ...common, ...(color ? { color } : {}), ...(emissive ? { emissive } : {}) });
    default:
      return new MeshToonMaterial({
        ...common,
        ...(color ? { color } : {}),
        ...(emissive ? { emissive } : {}),
        gradientMap: toonGradient(Math.min(8, Math.max(2, Math.round(extras.bands ?? 3)))),
      });
  }
}
