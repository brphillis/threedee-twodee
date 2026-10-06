import {
  type AssetDefaultsT,
  type AssetDefinitionT,
  CameraSettings,
  COMPASS_ANGLES,
  type ColorValueT,
  type CompassDirection,
  DIRECTION_SETS,
  type DirectionSpecT,
  ExportSettings,
  type IssueT,
  issuesFromZod,
  LightingSettings,
  type LightingSettingsT,
  type MaterialDefinitionT,
  type PaletteColorRefT,
  PixelSettings,
  type PresetKind,
  ResolvedAsset,
  type ResolvedAssetT,
  type ResolvedClipT,
  type ResolvedDirectionT,
  type ResolvedMaterialT,
  SheetSettings,
  type WarningT,
} from '@td2d/schema';
import { hexToLinearRgb, lightLevels } from '@td2d/schema/camera';
import type { z } from 'zod';
import { Td2dError } from '../errors.ts';
import { colourVariantName, expandModel } from '../model/expand.ts';
import { oklabToRgb, packRgb, rgbToHex, rgbToOklab, turnHueTowards } from '../pixel/oklab.ts';
import { clipTimes } from '../render/samples.ts';
import { checkClip, type RigLayer, resolveRig } from '../rig/resolve.ts';
import type { LoadedAsset } from './assets.ts';
import { BASE_SETTINGS, BUILTIN_DEFAULTS, BUILTIN_TYPE_DEFAULTS, MATERIAL_DEFAULTS } from './defaults.ts';
import type { Library } from './library.ts';
import { deepMerge, isPlainObject } from './merge.ts';
import { PROJECT_FILE, type Project } from './project.ts';

const SETTINGS_SCHEMAS = {
  camera: CameraSettings,
  lighting: LightingSettings,
  pixel: PixelSettings,
  sheet: SheetSettings,
  export: ExportSettings,
} as const satisfies { readonly [K in PresetKind]: z.ZodType };

const PRESET_META_KEYS = new Set(['$schema', 'schemaVersion', 'name', 'description']);

interface Layer {
  /** File the layer comes from, for issue reporting. Undefined for built-in layers. */
  readonly file: string | undefined;
  /** Path prefix inside that file. */
  readonly path: string;
  readonly values: AssetDefaultsT | undefined;
}

export interface ResolveResult {
  readonly asset: ResolvedAssetT;
  readonly warnings: readonly WarningT[];
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

function stripPresetMeta(data: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !PRESET_META_KEYS.has(k)));
}

function resolveDirections(
  spec: DirectionSpecT,
  mirror: readonly string[],
  file: string,
  issues: IssueT[],
): ResolvedDirectionT[] {
  const base = directionList(spec);

  const seen = new Set<string>();
  for (const [i, d] of base.entries()) {
    if (seen.has(d.name)) {
      issues.push({
        file,
        path: `directions[${i}]`,
        message: `Direction "${d.name}" is listed twice`,
        code: 'duplicate_direction',
      });
    }
    seen.add(d.name);
  }

  const mirrorOf = new Map<string, string>();
  for (const [i, entry] of mirror.entries()) {
    const [target = '', source = ''] = entry.split(':');
    const path = `mirror[${i}]`;
    if (!seen.has(target))
      issues.push({ file, path, message: `Mirror target "${target}" is not in directions`, code: 'unknown_direction' });
    if (!seen.has(source))
      issues.push({ file, path, message: `Mirror source "${source}" is not in directions`, code: 'unknown_direction' });
    if (target === source)
      issues.push({ file, path, message: 'A direction cannot mirror itself', code: 'invalid_mirror' });
    if (mirrorOf.has(target))
      issues.push({ file, path, message: `Direction "${target}" is mirrored twice`, code: 'invalid_mirror' });
    mirrorOf.set(target, source);
  }
  for (const [target, source] of mirrorOf) {
    if (mirrorOf.has(source)) {
      issues.push({
        file,
        path: 'mirror',
        message: `"${target}" mirrors "${source}", which is itself mirrored`,
        code: 'invalid_mirror',
      });
    }
  }
  return base.map((d) => ({ name: d.name, yaw: d.yaw, mirrorOf: mirrorOf.get(d.name) ?? null }));
}

/** The named yaws a direction spec stands for, in row order. */
export function directionList(spec: DirectionSpecT): { name: string; yaw: number }[] {
  if (typeof spec === 'string')
    return DIRECTION_SETS[spec].map((name) => ({ name, yaw: COMPASS_ANGLES[name as CompassDirection] }));
  if (!Array.isArray(spec)) {
    const start = spec.start ?? 0;
    return Array.from({ length: spec.count }, (_, i) => {
      const yaw = Number((start + (360 * i) / spec.count).toFixed(4));
      return { name: `a${Math.round(((yaw % 360) + 360) % 360)}`, yaw };
    });
  }
  return spec.map((d) =>
    typeof d === 'string' ? { name: d, yaw: COMPASS_ANGLES[d as CompassDirection] } : { name: d.name, yaw: d.yaw },
  );
}

/** Directions for a direction spec, outside any asset. Throws E_USAGE listing every problem. */
export function directionsFromSpec(spec: DirectionSpecT, mirror: readonly string[] = []): ResolvedDirectionT[] {
  const issues: IssueT[] = [];
  const directions = resolveDirections(spec, mirror, '', issues);
  if (issues.length > 0) {
    throw new Td2dError('E_USAGE', issues.map((i) => i.message).join('; '), {
      issues: issues.map(({ file: _f, ...rest }) => rest),
    });
  }
  return directions;
}

/** Complete settings for one preset of a kind, merged onto the base settings. */
export function presetSettings<K extends PresetKind>(
  library: Library,
  kind: K,
  name: string,
): z.infer<(typeof SETTINGS_SCHEMAS)[K]> {
  const entry = library.presets[kind].get(name);
  if (!entry) {
    throw new Td2dError('E_PRESET_NOT_FOUND', `${kind} preset "${name}" does not exist.`, {
      details: { available: [...library.presets[kind].keys()] },
    });
  }
  return SETTINGS_SCHEMAS[kind].parse(deepMerge(BASE_SETTINGS[kind], stripPresetMeta(entry.data))) as never;
}

/** Resolve a #rrggbb or palette reference to a lowercase hex colour, reporting missing palettes and indices. */
function resolveColorValue(
  value: ColorValueT,
  library: Library,
  file: string,
  path: string,
  issues: IssueT[],
): { color: string; ref: PaletteColorRefT | null } {
  if (typeof value === 'string') return { color: value.toLowerCase(), ref: null };
  const palette = library.palettes.get(value.palette);
  if (!palette) {
    issues.push({
      file,
      path: `${path}.palette`,
      message: `Palette "${value.palette}" does not exist`,
      code: 'palette_not_found',
    });
  } else if (value.index >= palette.data.colors.length) {
    issues.push({
      file,
      path: `${path}.index`,
      message: `Palette "${value.palette}" has ${palette.data.colors.length} colours, so index ${value.index} is out of range`,
      code: 'palette_index',
    });
  } else {
    return { color: (palette.data.colors[value.index] as string).toLowerCase(), ref: value };
  }
  return { color: '#ff00ff', ref: value };
}

/** Oklch hues the shadow bands of a hue-shifted material turn towards: blue-violet, or yellow for a negative shift. */
const COOL_SHADOW_HUE = 280;
const WARM_SHADOW_HUE = 95;

/**
 * The ramp `hueShift` makes from a colour: one colour per band, from the band lit by the ambient
 * light alone to the band in full light. Each band is the colour at the brightness the lights
 * give that band, which is what plain toon shading would show, with its hue turned towards
 * blue-violet (or yellow) by the band's share of the shift. Full light keeps the colour.
 */
export function hueShiftRamp(
  color: string,
  bands: number,
  hueShift: number,
  lighting: Pick<LightingSettingsT, 'lights'>,
): string[] {
  const { floor, ceil } = lightLevels(lighting);
  const darkest = ceil > 1e-6 ? Math.min(1, floor / ceil) : 1;
  const linear = hexToLinearRgb(color);
  const target = hueShift > 0 ? COOL_SHADOW_HUE : WARM_SHADOW_HUE;
  const ramp: string[] = [];
  for (let k = 0; k < bands; k++) {
    const level = k / (bands - 1);
    const brightness = darkest + (1 - darkest) * level;
    const lab = rgbToOklab(...linearToBytes(linear.map((c) => c * brightness) as [number, number, number]));
    const [r, g, b] = oklabToRgb(turnHueTowards(lab, target, Math.abs(hueShift) * (1 - level)));
    ramp.push(rgbToHex(packRgb(r, g, b)));
  }
  return ramp;
}

function linearToBytes(linear: readonly [number, number, number]): [number, number, number] {
  const encode = (c: number) =>
    Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return [encode(linear[0]), encode(linear[1]), encode(linear[2])];
}

function resolveMaterial(
  name: string,
  def: MaterialDefinitionT,
  library: Library,
  file: string,
  issues: IssueT[],
  lighting: Pick<LightingSettingsT, 'lights'>,
): ResolvedMaterialT {
  const at = (field: string) => `materials.${name}.${field}`;
  const shading = def.shading ?? MATERIAL_DEFAULTS.shading;
  let ramp: string[] | null = null;
  if (def.ramp) {
    ramp = def.ramp.map((c, i) => resolveColorValue(c, library, file, at(`ramp[${i}]`), issues).color);
    if (shading !== 'toon')
      issues.push({ file, path: at('shading'), message: 'A ramp needs toon shading', code: 'ramp_shading' });
    if (def.bands !== undefined && def.bands !== def.ramp.length)
      issues.push({
        file,
        path: at('bands'),
        message: `bands is set by the ramp's length (${def.ramp.length}); remove it or make it match`,
        code: 'ramp_bands',
      });
    if (def.hueShift !== undefined)
      issues.push({
        file,
        path: at('hueShift'),
        message: 'A material takes a ramp or a hueShift, not both',
        code: 'ramp_hue_shift',
      });
  }
  let color = '#ff00ff';
  let colorRef: PaletteColorRefT | null = null;
  if (def.color !== undefined) {
    ({ color, ref: colorRef } = resolveColorValue(def.color, library, file, at('color'), issues));
  } else if (ramp) {
    // The middle of the ramp stands for the material where one colour is needed: lines, the 3D view.
    color = ramp[Math.floor((ramp.length - 1) / 2)] as string;
  } else {
    issues.push({ file, path: at('color'), message: 'A material needs a color or a ramp', code: 'invalid_type' });
  }
  const bands = ramp ? ramp.length : (def.bands ?? MATERIAL_DEFAULTS.bands);
  if (def.hueShift !== undefined && !def.ramp) {
    if (shading !== 'toon')
      issues.push({ file, path: at('shading'), message: 'hueShift needs toon shading', code: 'ramp_shading' });
    else if (def.hueShift !== 0) ramp = hueShiftRamp(color, bands, def.hueShift, lighting);
  }
  return {
    color,
    colorRef,
    shading,
    bands,
    // Only when present, so assets without ramps resolve, and hash, as before.
    ...(ramp ? { ramp } : {}),
    emissive: (def.emissive ?? MATERIAL_DEFAULTS.emissive).toLowerCase(),
    outline: def.outline ?? MATERIAL_DEFAULTS.outline,
    opacity: def.opacity ?? MATERIAL_DEFAULTS.opacity,
    ...(def.description === undefined ? {} : { description: def.description }),
  };
}

function frameCount(duration: number, fps: number, loop: boolean): number {
  const steps = Math.round(duration * fps);
  return Math.max(1, loop ? steps : steps + 1);
}

/** Map a set of issue codes to the most specific error code. */
function errorCodeFor(issues: readonly IssueT[]) {
  const codes = new Set(issues.map((i) => i.code));
  if (codes.size === 1 && codes.has('component_cycle')) return 'E_COMPONENT_CYCLE' as const;
  if (codes.size === 1 && codes.has('component_not_found')) return 'E_COMPONENT_NOT_FOUND' as const;
  if (codes.size === 1 && codes.has('component_invalid')) return 'E_COMPONENT_INVALID' as const;
  if (codes.size === 1 && codes.has('import_failed')) return 'E_IMPORT_FAILED' as const;
  if (codes.size === 1 && codes.has('preset_not_found')) return 'E_PRESET_NOT_FOUND' as const;
  if (codes.size === 1 && codes.has('palette_not_found')) return 'E_PALETTE_NOT_FOUND' as const;
  return 'E_ASSET_INVALID' as const;
}

/**
 * Apply built-in defaults, project defaults and presets to a loaded asset and
 * check every cross-reference. Throws a Td2dError listing every problem found.
 */
export function resolveAsset(project: Project, loaded: LoadedAsset, library: Library): ResolveResult {
  const def: AssetDefinitionT = loaded.definition;
  const file = loaded.location.displayPath;
  const type = def.type;
  const issues: IssueT[] = [];
  const warnings: WarningT[] = [];

  const {
    schemaVersion: _sv,
    $schema: _s,
    id: _id,
    type: _t,
    description: _d,
    tags: _tags,
    model: _m,
    animation: _a,
    acceptance: _ac,
    ...assetSettings
  } = def;
  const layers: Layer[] = [
    { file: undefined, path: '', values: BUILTIN_DEFAULTS },
    { file: undefined, path: '', values: BUILTIN_TYPE_DEFAULTS[type] },
    { file: PROJECT_FILE, path: 'defaults', values: project.config.defaults },
    { file: PROJECT_FILE, path: `typeDefaults.${type}`, values: project.config.typeDefaults?.[type] },
    { file, path: '', values: assetSettings },
  ];

  const lastDefined = <K extends keyof AssetDefaultsT>(key: K): NonNullable<AssetDefaultsT[K]> => {
    let value: AssetDefaultsT[K] | undefined;
    for (const layer of layers) if (layer.values?.[key] !== undefined) value = layer.values[key];
    return value as NonNullable<AssetDefaultsT[K]>;
  };

  const settings = <K extends PresetKind>(kind: K): Record<string, unknown> & { preset: string | null } => {
    let preset: string | null = null;
    const expanded: unknown[] = [BASE_SETTINGS[kind]];
    for (const layer of layers) {
      const value = layer.values?.[kind];
      if (value === undefined) continue;
      const name = typeof value === 'string' ? value : (value as { preset?: string }).preset;
      if (name !== undefined) {
        const entry = library.presets[kind].get(name);
        const where = joinPath(layer.path, typeof value === 'string' ? kind : `${kind}.preset`);
        if (!entry) {
          issues.push({
            ...(layer.file ? { file: layer.file } : {}),
            path: where,
            message: `${kind} preset "${name}" does not exist`,
            code: 'preset_not_found',
          });
        } else {
          preset = name;
          expanded.push(stripPresetMeta(entry.data));
        }
      }
      if (isPlainObject(value)) {
        const { preset: _p, ...overrides } = value as Record<string, unknown>;
        expanded.push(overrides);
      }
    }
    const merged = deepMerge(...expanded);
    const result = SETTINGS_SCHEMAS[kind].safeParse(merged);
    if (!result.success) {
      for (const issue of issuesFromZod(result.error, undefined, { input: merged, schema: SETTINGS_SCHEMAS[kind] })) {
        issues.push({
          file,
          path: joinPath(kind, issue.path),
          message: `${issue.message} (after applying presets)`,
          ...(issue.code ? { code: issue.code } : {}),
        });
      }
      return { ...(BASE_SETTINGS[kind] as object), preset } as Record<string, unknown> & { preset: string | null };
    }
    return { ...(result.data as object), preset } as Record<string, unknown> & { preset: string | null };
  };

  const camera = settings('camera');
  const lighting = settings('lighting');
  const pixel = settings('pixel');
  const sheet = settings('sheet');
  const exportSettings = settings('export');

  const render = deepMerge(...layers.map((l) => l.values?.render)) as ResolvedAssetT['render'];
  const directions = resolveDirections(lastDefined('directions'), lastDefined('mirror'), file, issues);

  const rigLayers: RigLayer[] = [];
  for (const layer of layers) {
    const value = layer.values?.rig;
    if (value !== undefined) rigLayers.push({ file: layer.file, path: joinPath(layer.path, 'rig'), value });
  }
  const rig = resolveRig(rigLayers, library, issues);
  const boneNames = new Set(rig?.bones.map((b) => b.name) ?? []);

  const expanded = expandModel(project, { file, dir: loaded.location.dir }, def.model, issues);
  for (const leaf of expanded.leaves) {
    const { part } = leaf;
    const where = (field: string) => ({ file: leaf.file || file, path: leaf.path ? `${leaf.path}.${field}` : field });
    const skinned = part.skin !== undefined && part.skin !== 'rigid';
    if (!rig && (part.bone !== undefined || skinned)) {
      issues.push({
        ...where(part.bone !== undefined ? 'bone' : 'skin'),
        message: `Part "${part.id}" follows a bone, but the asset has no rig. Add "rig": "humanoid-basic" or another rig`,
        code: 'no_rig',
      });
      continue;
    }
    if (part.bone !== undefined && !boneNames.has(part.bone)) {
      issues.push({
        ...where('bone'),
        message: `Bone "${part.bone}" is not in the rig. Bones: ${[...boneNames].join(', ')}`,
        code: 'unknown_bone',
      });
    }
    for (const [i, b] of (part.skinBones ?? []).entries()) {
      if (!boneNames.has(b))
        issues.push({ ...where(`skinBones[${i}]`), message: `Bone "${b}" is not in the rig`, code: 'unknown_bone' });
    }
    if (part.skinBones !== undefined && !skinned) {
      issues.push({
        ...where('skinBones'),
        message: 'skinBones only applies with skin "nearest-bone" or "two-bone-blend"',
        code: 'invalid_skin',
      });
    }
  }

  // Materials: component defaults, then project materials, then asset materials, each replacing by name.
  const materialDefs: Record<string, MaterialDefinitionT> = { ...expanded.componentMaterials };
  for (const layer of layers.slice(2, 4)) Object.assign(materialDefs, layer.values?.materials ?? {});
  Object.assign(materialDefs, def.materials ?? {});
  const materials: Record<string, ResolvedMaterialT> = {};
  for (const [name, m] of Object.entries(materialDefs))
    materials[name] = resolveMaterial(name, m, library, file, issues, lighting as unknown as LightingSettingsT);

  const used = new Set<string>();
  const known = Object.keys(materials);
  const checkMaterial = (name: string, leaf: { file: string; path: string }, field: string) => {
    if (name in materials) {
      used.add(name);
      return true;
    }
    issues.push({
      file: leaf.file || file,
      path: leaf.path ? `${leaf.path}.${field}` : field,
      message: `Material "${name}" is not defined${known.length ? `. Defined: ${known.join(', ')}` : ''}`,
      code: 'unknown_material',
    });
    return false;
  };
  for (const leaf of expanded.leaves) {
    const { part } = leaf;
    if (!checkMaterial(part.material, leaf, 'material')) continue;
    if (part.type === 'import') {
      for (const [from, to] of Object.entries(part.materialMap ?? {})) checkMaterial(to, leaf, `materialMap.${from}`);
      continue;
    }
    if (part.color !== undefined) {
      // A part colour becomes its own material, keyed by part id, so geometry never depends on colour.
      // It replaces an explicit ramp too; a hueShift makes a new ramp from the part's colour.
      const { ramp: _ramp, ...base } = materialDefs[part.material] as MaterialDefinitionT;
      materials[colourVariantName(part.material, part.id)] = resolveMaterial(
        `${part.material}~${part.id}`,
        { ...base, color: part.color },
        library,
        leaf.file || file,
        issues,
        lighting as unknown as LightingSettingsT,
      );
    }
  }
  for (const name of Object.keys(def.materials ?? {})) {
    if (!used.has(name))
      warnings.push({
        code: 'W_UNUSED_MATERIAL',
        message: `Material "${name}" is not used by any visible part.`,
        file,
        path: `materials.${name}`,
        assetId: loaded.location.id,
      });
  }
  for (const name of used) {
    const m = materials[name];
    if (m && m.opacity < 1) {
      warnings.push({
        code: 'W_OPACITY_THRESHOLDED',
        message: `Material "${name}" has opacity ${m.opacity}. Sprite alpha is binary, so it will render opaque or vanish.`,
        file,
        path: `materials.${name}.opacity`,
        assetId: loaded.location.id,
        hint: 'Use opacity 1 and pick a lighter colour, or use dithering in a later version.',
      });
    }
  }

  const paletteMode = String(pixel.palette);
  let paletteColors: string[] | null = null;
  if (paletteMode.startsWith('fixed:')) {
    const name = paletteMode.slice('fixed:'.length);
    paletteColors = library.palettes.get(name)?.data.colors.map((c) => c.toLowerCase()) ?? null;
    if (!library.palettes.has(name))
      issues.push({
        file,
        path: 'pixel.palette',
        message: `Palette "${name}" does not exist`,
        code: 'palette_not_found',
      });
  }

  const fps = def.animation?.fps ?? lastDefined('fps');
  const clipDefs = def.animation?.clips ?? { idle: { duration: 1 / fps, loop: true } };
  if (Object.keys(clipDefs).length === 0)
    issues.push({ file, path: 'animation.clips', message: 'At least one clip is required', code: 'too_small' });
  const clips: Record<string, ResolvedClipT> = {};
  for (const [name, c] of Object.entries(clipDefs)) {
    const clipFps = c.fps ?? fps;
    const loop = c.loop ?? true;
    checkClip(name, c, fps, rig, file, issues, warnings, loaded.location.id);
    const times = c.sampleTimes ?? clipTimes(c.duration, frameCount(c.duration, clipFps, loop), loop);
    clips[name] = {
      duration: c.duration,
      loop,
      fps: clipFps,
      frames: times.length,
      times,
      motion: c.motion ?? false,
      interpolation: c.interpolation ?? 'linear',
      keys: c.keys ?? null,
      generator: c.generator ?? null,
      ...(c.layers ? { layers: c.layers } : {}),
      ...(c.description === undefined ? {} : { description: c.description }),
    };
  }
  for (const [i, name] of (def.acceptance?.requiredClips ?? []).entries()) {
    if (!(name in clips))
      issues.push({
        file,
        path: `acceptance.requiredClips[${i}]`,
        message: `Required clip "${name}" is not defined`,
        code: 'missing_clip',
      });
  }

  if (issues.length > 0) {
    const references = issues.every((i) =>
      /^(unknown_|missing_|palette_not_found|preset_not_found|palette_index|no_rig)/.test(i.code ?? ''),
    );
    throw new Td2dError(
      errorCodeFor(issues),
      `${file} has ${issues.length} problem${issues.length === 1 ? '' : 's'}.`,
      {
        file,
        issues,
        ...(references
          ? {
              hint: 'Each issue names something that is not defined, and lists what is. Use one of those, or define it.',
            }
          : {}),
      },
    );
  }

  const candidate: ResolvedAssetT = {
    id: loaded.location.id,
    type,
    ...(def.description === undefined ? {} : { description: def.description }),
    tags: def.tags ?? [],
    sourceFile: file,
    frame: lastDefined('frame'),
    pixelsPerUnit: lastDefined('pixelsPerUnit'),
    camera: camera as ResolvedAssetT['camera'],
    lighting: lighting as ResolvedAssetT['lighting'],
    directions,
    materials,
    model: {
      ...(def.model.description ? { description: def.model.description } : {}),
      parts: expanded.parts,
      imports: expanded.imports,
    },
    rig,
    animation: { fps, clips },
    render,
    pixel: pixel as ResolvedAssetT['pixel'],
    paletteColors,
    sheet: sheet as ResolvedAssetT['sheet'],
    export: exportSettings as ResolvedAssetT['export'],
    acceptance: def.acceptance ?? {},
  };
  const checked = ResolvedAsset.safeParse(candidate);
  if (!checked.success) {
    throw new Td2dError('E_INTERNAL', `Resolving ${file} produced an invalid result.`, {
      file,
      issues: issuesFromZod(checked.error, file),
    });
  }
  return { asset: checked.data, warnings };
}
