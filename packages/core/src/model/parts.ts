import type { PartDefinitionT, PartType } from '@td2d/schema';
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { Td2dError } from '../errors.ts';
import type { LeafPart } from './expand.ts';

export type PrimitivePart = Exclude<LeafPart, { type: 'import' }>;
export type PrimitiveType = PrimitivePart['type'];

export interface PartBuildContext {
  /** File and path of the part, for error messages. */
  readonly file: string;
  readonly path: string;
}

type PartOf<K extends PrimitiveType> = Extract<PrimitivePart, { type: K }>;

/** Builds the local geometry of one primitive part type, centred on the part's own origin. */
export interface PartBuilder<K extends PrimitiveType = PrimitiveType> {
  readonly type: K;
  build(part: PartOf<K>, ctx: PartBuildContext): BufferGeometry;
}

/** A triangular prism: full height at the back (-Z), zero at the front (+Z). Faces are flat. */
function wedgeGeometry(w: number, h: number, d: number): BufferGeometry {
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const zb = -d / 2;
  const zf = d / 2;
  const v = {
    a: [x0, y0, zb],
    b: [x1, y0, zb],
    c: [x1, y0, zf],
    d: [x0, y0, zf],
    e: [x0, y1, zb],
    f: [x1, y1, zb],
  } as const;
  // Counter-clockwise when seen from outside.
  const faces: (keyof typeof v)[][] = [
    ['a', 'b', 'c'],
    ['a', 'c', 'd'],
    ['a', 'e', 'f'],
    ['a', 'f', 'b'],
    ['d', 'c', 'f'],
    ['d', 'f', 'e'],
    ['a', 'd', 'e'],
    ['b', 'f', 'c'],
  ];
  const positions = faces.flatMap((f) => f.flatMap((k) => [...v[k]]));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function shapeFrom(points: readonly (readonly [number, number])[]): Shape {
  return new Shape(points.map(([x, y]) => new Vector2(x, y)));
}

const BUILDERS: { readonly [K in PrimitiveType]: PartBuilder<K> } = {
  box: { type: 'box', build: (p) => new BoxGeometry(p.size[0], p.size[1], p.size[2]) },
  cylinder: {
    type: 'cylinder',
    build: (p, ctx) => {
      const top = p.radiusTop ?? p.radius;
      const bottom = p.radiusBottom ?? p.radius;
      if (top === undefined || bottom === undefined || (top === 0 && bottom === 0)) {
        throw new Td2dError(
          'E_ASSET_INVALID',
          `Cylinder "${p.id}" needs radius, or radiusTop and radiusBottom, with at least one above 0.`,
          {
            file: ctx.file,
            issues: [
              {
                file: ctx.file,
                path: `${ctx.path}.radius`,
                message: 'Set radius, or radiusTop and radiusBottom',
                code: 'missing_radius',
              },
            ],
          },
        );
      }
      return new CylinderGeometry(top, bottom, p.height, p.segments ?? 16, p.heightSegments ?? 1);
    },
  },
  cone: { type: 'cone', build: (p) => new CylinderGeometry(0, p.radius, p.height, p.segments ?? 16, 1) },
  sphere: { type: 'sphere', build: (p) => new SphereGeometry(p.radius, p.widthSegments ?? 16, p.heightSegments ?? 12) },
  capsule: {
    type: 'capsule',
    build: (p) =>
      new CapsuleGeometry(p.radius, p.length, p.capSegments ?? 6, p.radialSegments ?? 16, p.heightSegments ?? 1),
  },
  torus: {
    type: 'torus',
    build: (p) =>
      new TorusGeometry(p.radius, p.tube, p.radialSegments ?? 12, p.tubularSegments ?? 32).rotateX(-Math.PI / 2),
  },
  // PlaneGeometry lies in XY facing +Z; turn it to lie flat facing up.
  plane: { type: 'plane', build: (p) => new PlaneGeometry(p.size[0], p.size[1]).rotateX(-Math.PI / 2) },
  wedge: { type: 'wedge', build: (p) => wedgeGeometry(p.size[0], p.size[1], p.size[2]) },
  lathe: {
    type: 'lathe',
    build: (p, ctx) => {
      if (p.profile.some(([r]) => r < 0)) {
        throw new Td2dError('E_ASSET_INVALID', `Lathe "${p.id}" has a negative radius.`, {
          file: ctx.file,
          issues: [
            {
              file: ctx.file,
              path: `${ctx.path}.profile`,
              message: 'Every profile radius must be 0 or more',
              code: 'too_small',
            },
          ],
        });
      }
      return new LatheGeometry(
        p.profile.map(([r, y]) => new Vector2(r, y)),
        p.segments ?? 24,
      );
    },
  },
  extrude: {
    type: 'extrude',
    build: (p) => {
      const shape = shapeFrom(p.shape);
      for (const hole of p.holes ?? []) shape.holes.push(new Path(hole.map(([x, y]) => new Vector2(x, y))));
      return new ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false, curveSegments: 1, steps: 1 }).translate(
        0,
        0,
        -p.depth / 2,
      );
    },
  },
};

/**
 * Version of each part type's geometry: the builders here, and groups, CSG, components and
 * imports elsewhere in model/. Bump one when the same part would give different geometry; the
 * model stage's cache key includes them.
 */
export const PART_VERSIONS: { readonly [K in PartType]: number } = {
  group: 1,
  csg: 1,
  component: 1,
  import: 1,
  box: 1,
  cylinder: 1,
  cone: 1,
  sphere: 1,
  capsule: 1,
  torus: 1,
  plane: 1,
  wedge: 1,
  lathe: 1,
  extrude: 1,
};

export function partBuilder<K extends PrimitiveType>(type: K): PartBuilder<K> {
  const builder = BUILDERS[type];
  // Every registered part type has a builder (tested), so this is a bug if reached.
  if (!builder) throw new Td2dError('E_INTERNAL', `Part type "${type}" has no builder.`);
  return builder;
}

export function listPartBuilders(): PrimitiveType[] {
  return Object.keys(BUILDERS) as PrimitiveType[];
}

const DEG = Math.PI / 180;

/** Local-to-parent matrix: move the pivot to the origin, scale, rotate (X, then Y, then Z, in degrees), then translate. */
export function partMatrix(part: Pick<PartDefinitionT, 'position' | 'rotation' | 'scale' | 'pivot'>): Matrix4 {
  const [px = 0, py = 0, pz = 0] = part.position ?? [];
  const [rx = 0, ry = 0, rz = 0] = part.rotation ?? [];
  const [vx = 0, vy = 0, vz = 0] = part.pivot ?? [];
  const s = part.scale ?? 1;
  const scale = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(s[0], s[1], s[2]);
  const rotation = new Quaternion().setFromEuler(new Euler(rx * DEG, ry * DEG, rz * DEG, 'XYZ'));
  const local = new Matrix4().compose(new Vector3(px, py, pz), rotation, scale);
  return vx === 0 && vy === 0 && vz === 0 ? local : local.multiply(new Matrix4().makeTranslation(-vx, -vy, -vz));
}
