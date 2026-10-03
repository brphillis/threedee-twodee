import type { RenderMaterial } from '@td2d/schema';
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

/** Build a td2d material from an explicit render material. */
export function materialFromSpec(name: string, spec: RenderMaterial, vertexColors = false): Material {
  return td2dMaterial({
    name,
    color: new Color(spec.color),
    emissive: new Color(spec.emissive),
    vertexColors,
    userData: { td2d: { shading: spec.shading, bands: spec.bands } },
  });
}

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
