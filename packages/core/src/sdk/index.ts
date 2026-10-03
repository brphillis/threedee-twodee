/**
 * The td2d asset SDK: typed helpers that build plain asset definitions in TypeScript.
 * A script's default export is an asset definition, or a function returning one, and
 * `td2d asset emit <script>` writes it to assets/<id>/asset.json. Everything here returns
 * plain JSON-compatible objects, so the emitted file is the source of truth.
 */
import {
  AssetDefinition,
  type AssetDefinitionT,
  type BoxPartT,
  type CapsulePartT,
  type ComponentPartT,
  type ConePartT,
  type CsgPartT,
  CURRENT_INPUT_SCHEMA_VERSION,
  type CylinderPartT,
  type ExtrudePartT,
  type GroupPartT,
  type ImportPartT,
  issuesFromZod,
  type LathePartT,
  type PartDefinitionT,
  type PlanePartT,
  type SpherePartT,
  type TorusPartT,
  type WedgePartT,
} from '@td2d/schema';

type Props<T> = Omit<T, 'type'>;
type Transform = Partial<
  Pick<GroupPartT, 'position' | 'rotation' | 'scale' | 'pivot' | 'visible' | 'repeat' | 'mirror' | 'description'>
>;

export const box = (p: Props<BoxPartT>): BoxPartT => ({ type: 'box', ...p });
export const cylinder = (p: Props<CylinderPartT>): CylinderPartT => ({ type: 'cylinder', ...p });
export const cone = (p: Props<ConePartT>): ConePartT => ({ type: 'cone', ...p });
export const sphere = (p: Props<SpherePartT>): SpherePartT => ({ type: 'sphere', ...p });
export const capsule = (p: Props<CapsulePartT>): CapsulePartT => ({ type: 'capsule', ...p });
export const torus = (p: Props<TorusPartT>): TorusPartT => ({ type: 'torus', ...p });
export const plane = (p: Props<PlanePartT>): PlanePartT => ({ type: 'plane', ...p });
export const wedge = (p: Props<WedgePartT>): WedgePartT => ({ type: 'wedge', ...p });
export const lathe = (p: Props<LathePartT>): LathePartT => ({ type: 'lathe', ...p });
export const extrude = (p: Props<ExtrudePartT>): ExtrudePartT => ({ type: 'extrude', ...p });
export const importGlb = (p: Props<ImportPartT>): ImportPartT => ({ type: 'import', ...p });

export const group = (id: string, parts: PartDefinitionT[], transform: Transform = {}): GroupPartT => ({
  type: 'group',
  id,
  ...transform,
  parts,
});

const csg =
  (op: CsgPartT['op']) =>
  (id: string, parts: PartDefinitionT[], transform: Transform = {}): CsgPartT => ({
    type: 'csg',
    id,
    op,
    ...transform,
    parts,
  });
export const union: (id: string, parts: PartDefinitionT[], transform?: Transform) => CsgPartT = csg('union');
export const subtract: (id: string, parts: PartDefinitionT[], transform?: Transform) => CsgPartT = csg('subtract');
export const intersect: (id: string, parts: PartDefinitionT[], transform?: Transform) => CsgPartT = csg('intersect');
export const hull: (id: string, parts: PartDefinitionT[], transform?: Transform) => CsgPartT = csg('hull');

export const component = (
  id: string,
  name: string,
  params: ComponentPartT['params'] = {},
  rest: Omit<Props<ComponentPartT>, 'id' | 'component' | 'params'> = {},
): ComponentPartT => ({
  type: 'component',
  id,
  component: name,
  ...(Object.keys(params ?? {}).length > 0 ? { params } : {}),
  ...rest,
});

/** Points on a circle in the XY plane, counter-clockwise, for extrude shapes. */
export function circlePoints(radius: number, segments = 16, centre: [number, number] = [0, 0]): [number, number][] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return [round(centre[0] + radius * Math.cos(a)), round(centre[1] + radius * Math.sin(a))];
  });
}

/** Round to 6 decimals so emitted JSON stays short and stable. */
export function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export type AssetInput = Omit<AssetDefinitionT, 'schemaVersion' | '$schema'> & { schemaVersion?: string };

/** Validate and return an asset definition. Throws with every problem listed if it is invalid. */
export function defineAsset(input: AssetInput): AssetDefinitionT {
  const candidate = { schemaVersion: CURRENT_INPUT_SCHEMA_VERSION, ...JSON.parse(JSON.stringify(input)) };
  const result = AssetDefinition.safeParse(candidate);
  if (!result.success) {
    const lines = issuesFromZod(result.error, undefined, { input: candidate, schema: AssetDefinition }).map(
      (i) => `  ${i.path || '(document)'}: ${i.message}`,
    );
    throw new Error(`Invalid asset definition:\n${lines.join('\n')}`);
  }
  return result.data;
}
