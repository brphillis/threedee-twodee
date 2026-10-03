import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ComponentFile,
  type ComponentFileT,
  formatPath,
  type IssueT,
  issuesFromZod,
  type MaterialDefinitionT,
  type ModelDefinitionT,
  PartDefinition,
  type PartDefinitionT,
} from '@td2d/schema';
import { isTd2dError } from '../errors.ts';
import { readJsonFile } from '../fs/json.ts';
import { relativePosix, resolveInside } from '../fs/paths.ts';
import { sha256Hex } from '../pipeline/hash.ts';
import type { Project } from '../project/project.ts';
import { type ParamValue, substitute } from './expr.ts';

/** Components may include components this many levels deep. */
export const MAX_COMPONENT_DEPTH = 8;
/** Largest imported model td2d reads. */
export const MAX_IMPORT_BYTES: number = 50 * 1024 * 1024;

export interface ExpandedLeaf {
  readonly part: LeafPart;
  readonly file: string;
  readonly path: string;
}

export type LeafPart = Exclude<PartDefinitionT, { type: 'group' | 'csg' | 'component' }>;

export interface ExpandedModel {
  readonly parts: PartDefinitionT[];
  /** Imported file, project-relative, to its sha256. */
  readonly imports: Record<string, string>;
  /** Default materials contributed by components, by name. */
  readonly componentMaterials: Record<string, MaterialDefinitionT>;
  /** Every leaf part after expansion, with the file and path of the part it came from. */
  readonly leaves: ExpandedLeaf[];
}

interface Scope {
  readonly file: string;
  /** Directory the file lives in, for relative import paths. */
  readonly dir: string;
  readonly idPrefix: string;
  readonly materialMap: Readonly<Record<string, string>>;
  readonly stack: readonly string[];
}

type Group = Extract<PartDefinitionT, { type: 'group' }>;

function withoutModifiers<T extends PartDefinitionT>(part: T): T {
  const { repeat: _r, mirror: _m, ...rest } = part as T & { repeat?: unknown; mirror?: unknown };
  return rest as T;
}

/** Append a suffix to a part id and every descendant id, keeping ids unique across copies. */
function suffixIds(part: PartDefinitionT, suffix: string): PartDefinitionT {
  const copy = { ...part, id: `${part.id}${suffix}` } as PartDefinitionT;
  if (copy.type === 'group' || copy.type === 'csg') copy.parts = copy.parts.map((p) => suffixIds(p, suffix));
  return copy;
}

function group(
  id: string,
  parts: PartDefinitionT[],
  transform: Partial<Pick<Group, 'position' | 'rotation' | 'scale'>> = {},
): Group {
  return { type: 'group', id, ...transform, parts };
}

/** Swap left and right in a bone name: "leftUpperArm" and "rightUpperArm", "front-left-leg" and "front-right-leg". */
export function swapSide(name: string): string {
  const camel = /^(left|right)(?=[A-Z0-9]|$)/.exec(name);
  if (camel) return (camel[1] === 'left' ? 'right' : 'left') + name.slice((camel[1] as string).length);
  return name
    .split('-')
    .map((t) => (t === 'left' ? 'right' : t === 'right' ? 'left' : t))
    .join('-');
}

/** A copy mirrored across x: every bone named in it moves to the other side. */
function swapSides(part: PartDefinitionT): PartDefinitionT {
  const copy = { ...part } as PartDefinitionT;
  if (copy.bone !== undefined) copy.bone = swapSide(copy.bone);
  if (copy.skinBones !== undefined) copy.skinBones = copy.skinBones.map(swapSide);
  if (copy.type === 'group' || copy.type === 'csg') copy.parts = copy.parts.map(swapSides);
  return copy;
}

/** Replace repeat and mirror with explicit groups of copies. */
function applyModifiers(part: PartDefinitionT): PartDefinitionT[] {
  const repeat = 'repeat' in part ? part.repeat : undefined;
  const mirror = 'mirror' in part ? part.mirror : undefined;
  const base = withoutModifiers(part);
  let nodes: PartDefinitionT[] = [base];
  if (repeat) {
    const [ox = 0, oy = 0, oz = 0] = repeat.offset ?? [];
    const [rx = 0, ry = 0, rz = 0] = repeat.rotation ?? [];
    nodes = Array.from({ length: repeat.count }, (_, i) =>
      group(`${base.id}-${i}`, [suffixIds(base, `-${i}`)], {
        position: [ox * i, oy * i, oz * i],
        rotation: [rx * i, ry * i, rz * i],
      }),
    );
  }
  if (mirror) {
    for (const axis of typeof mirror === 'string' ? [mirror] : mirror) {
      const scale: [number, number, number] = [axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1];
      nodes = [
        ...nodes,
        ...nodes.map((n) => {
          const copy = suffixIds(n, `-m${axis}`);
          return group(`${n.id}-m${axis}`, [axis === 'x' ? swapSides(copy) : copy], { scale });
        }),
      ];
    }
  }
  return nodes;
}

class Expander {
  readonly issues: IssueT[];
  readonly imports: Record<string, string> = {};
  readonly componentMaterials: Record<string, MaterialDefinitionT> = {};
  /** Expanded id of every authored part to where it was written. */
  readonly origins = new Map<string, { file: string; path: string }>();
  private readonly ids = new Map<string, string>();
  private readonly components = new Map<string, { file: string; display: string; data: ComponentFileT } | null>();
  private readonly project: Project;

  constructor(project: Project, issues: IssueT[]) {
    this.project = project;
    this.issues = issues;
  }

  private issue(file: string, path: string, message: string, code: string): void {
    this.issues.push({ file, path, message, code });
  }

  private loadComponent(name: string, file: string, path: string) {
    if (this.components.has(name)) return this.components.get(name) ?? null;
    let found: { file: string; display: string; data: ComponentFileT } | null = null;
    for (const dir of this.project.paths.components) {
      const candidate = join(dir, `${name}.json`);
      if (!existsSync(candidate)) continue;
      const display = relativePosix(this.project.root, candidate);
      try {
        const input = readJsonFile(candidate, display);
        const result = ComponentFile.safeParse(input);
        if (!result.success) {
          this.issues.push(
            ...issuesFromZod(result.error, display, { input, schema: ComponentFile }).map((i) => ({
              ...i,
              code: i.code ?? 'component_invalid',
            })),
          );
        } else if (result.data.name !== name) {
          this.issue(
            display,
            'name',
            `Name "${result.data.name}" must match the file name "${name}"`,
            'component_invalid',
          );
        } else {
          found = { file: candidate, display, data: result.data };
        }
      } catch (error) {
        if (isTd2dError(error) && error.issues) this.issues.push(...error.issues);
        else throw error;
      }
      break;
    }
    if (!found && !this.issues.some((i) => i.file?.endsWith(`${name}.json`))) {
      this.issue(
        file,
        path,
        `Component "${name}" not found in ${this.project.paths.components.map((d) => relativePosix(this.project.root, d)).join(', ')}`,
        'component_not_found',
      );
    }
    this.components.set(name, found);
    return found;
  }

  private claimId(id: string, file: string, path: string): void {
    const previous = this.ids.get(id);
    if (previous !== undefined)
      this.issue(file, `${path}.id`, `Part id "${id}" is already used at ${previous}`, 'duplicate_part_id');
    else this.ids.set(id, path);
    this.origins.set(id, { file, path });
  }

  private expandComponent(
    part: Extract<PartDefinitionT, { type: 'component' }>,
    id: string,
    scope: Scope,
    path: string,
  ): PartDefinitionT | null {
    if (scope.stack.includes(part.component)) {
      this.issue(
        scope.file,
        `${path}.component`,
        `Component "${part.component}" includes itself: ${[...scope.stack, part.component].join(' > ')}`,
        'component_cycle',
      );
      return null;
    }
    if (scope.stack.length >= MAX_COMPONENT_DEPTH) {
      this.issue(
        scope.file,
        `${path}.component`,
        `Components nest more than ${MAX_COMPONENT_DEPTH} deep: ${[...scope.stack, part.component].join(' > ')}`,
        'component_cycle',
      );
      return null;
    }
    const component = this.loadComponent(part.component, scope.file, `${path}.component`);
    if (!component) return null;
    const declared = component.data.params ?? {};
    const values: Record<string, ParamValue> = {};
    let ok = true;
    for (const key of Object.keys(part.params ?? {})) {
      if (!(key in declared)) {
        this.issue(
          scope.file,
          `${path}.params.${key}`,
          `Component "${part.component}" has no parameter "${key}". Parameters: ${Object.keys(declared).join(', ') || 'none'}`,
          'component_invalid',
        );
        ok = false;
      }
    }
    for (const [key, spec] of Object.entries(declared)) {
      const value = part.params?.[key] ?? spec.default;
      const where = `${path}.params.${key}`;
      if (value === undefined) {
        this.issue(
          scope.file,
          where,
          `Parameter "${key}" of component "${part.component}" is required`,
          'component_invalid',
        );
        ok = false;
      } else if (typeof value !== spec.type) {
        this.issue(scope.file, where, `Parameter "${key}" must be a ${spec.type}`, 'component_invalid');
        ok = false;
      } else if (
        typeof value === 'number' &&
        ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max))
      ) {
        this.issue(
          scope.file,
          where,
          `Parameter "${key}" must be between ${spec.min ?? '-infinity'} and ${spec.max ?? 'infinity'}`,
          'component_invalid',
        );
        ok = false;
      } else {
        values[key] = value;
      }
    }
    if (!ok) return null;

    const children: PartDefinitionT[] = [];
    component.data.parts.forEach((raw, j) => {
      const substituted = substitute(raw, values, (p, message) =>
        this.issue(component.display, formatPath(['parts', j, ...p]), message, 'component_invalid'),
      );
      const parsed = PartDefinition.safeParse(substituted);
      if (!parsed.success) {
        this.issues.push(
          ...issuesFromZod(parsed.error, undefined, { input: substituted, schema: PartDefinition }).map((i) => ({
            ...i,
            file: component.display,
            path: formatPath(['parts', j]) + (i.path ? `.${i.path}` : ''),
          })),
        );
        return;
      }
      children.push(parsed.data);
    });
    for (const [name, def] of Object.entries(component.data.materials ?? {})) {
      if (!(name in (part.materials ?? {})) && !(name in this.componentMaterials)) this.componentMaterials[name] = def;
    }
    const materialMap = {
      ...Object.fromEntries(
        Object.entries(part.materials ?? {}).map(([from, to]) => [from, scope.materialMap[to] ?? to]),
      ),
    };
    const inner: Scope = {
      file: component.display,
      dir: dirname(component.file),
      idPrefix: `${id}-`,
      materialMap,
      stack: [...scope.stack, part.component],
    };
    const expanded = this.expandList(children, inner, 'parts');
    const { position, rotation, scale, pivot, bone, skin, skinBones } = part;
    return {
      type: 'group',
      id,
      ...(position ? { position } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(pivot ? { pivot } : {}),
      ...(bone !== undefined ? { bone } : {}),
      ...(skin !== undefined ? { skin } : {}),
      ...(skinBones !== undefined ? { skinBones } : {}),
      parts: expanded,
    };
  }

  private expandImport(
    part: Extract<PartDefinitionT, { type: 'import' }>,
    id: string,
    scope: Scope,
    path: string,
  ): PartDefinitionT | null {
    let absolute: string;
    try {
      absolute = resolveInside(this.project.root, relativePosix(this.project.root, join(scope.dir, part.src)));
    } catch {
      this.issue(scope.file, `${path}.src`, `"${part.src}" points outside the project`, 'import_failed');
      return null;
    }
    const display = relativePosix(this.project.root, absolute);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      this.issue(scope.file, `${path}.src`, `File "${display}" does not exist`, 'import_failed');
      return null;
    }
    if (statSync(absolute).size > MAX_IMPORT_BYTES) {
      this.issue(
        scope.file,
        `${path}.src`,
        `File "${display}" is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`,
        'import_failed',
      );
      return null;
    }
    this.imports[display] = sha256Hex(readFileSync(absolute));
    return {
      ...part,
      id,
      src: display,
      material: scope.materialMap[part.material] ?? part.material,
      ...(part.materialMap
        ? {
            materialMap: Object.fromEntries(
              Object.entries(part.materialMap).map(([k, v]) => [k, scope.materialMap[v] ?? v]),
            ),
          }
        : {}),
    };
  }

  private expandOne(part: PartDefinitionT, scope: Scope, path: string): PartDefinitionT[] {
    if (part.visible === false) return [];
    const id = `${scope.idPrefix}${part.id}`;
    this.claimId(id, scope.file, path);
    let node: PartDefinitionT | null;
    switch (part.type) {
      case 'component':
        node = this.expandComponent(part, id, scope, path);
        break;
      case 'import':
        node = this.expandImport(part, id, scope, path);
        break;
      case 'group':
      case 'csg':
        node = { ...part, id, parts: this.expandList(part.parts, scope, `${path}.parts`) } as PartDefinitionT;
        break;
      default:
        node = { ...part, id, material: scope.materialMap[part.material] ?? part.material } as PartDefinitionT;
    }
    if (!node) return [];
    if (part.type === 'component') {
      node = {
        ...node,
        ...('repeat' in part && part.repeat ? { repeat: part.repeat } : {}),
        ...('mirror' in part && part.mirror ? { mirror: part.mirror } : {}),
      } as PartDefinitionT;
    }
    return applyModifiers(node);
  }

  /** Where a leaf was written. Copies made by repeat and mirror map back to their source part. */
  origin(id: string): { file: string; path: string } {
    let current = id;
    for (;;) {
      const found = this.origins.get(current);
      if (found) return found;
      const shorter = current.replace(/-(\d+|m[xyz])$/, '');
      if (shorter === current) return { file: '', path: '' };
      current = shorter;
    }
  }

  expandList(parts: readonly PartDefinitionT[], scope: Scope, path: string): PartDefinitionT[] {
    return parts.flatMap((p, i) => this.expandOne(p, scope, `${path}[${i}]`));
  }
}

/**
 * Expand components, repeats and mirrors into explicit groups, hash imported files, and
 * check part ids. Problems are added to `issues`; the result is still returned so every
 * problem can be reported at once.
 */
export function expandModel(
  project: Project,
  asset: { readonly file: string; readonly dir: string },
  model: ModelDefinitionT,
  issues: IssueT[],
): ExpandedModel {
  const expander = new Expander(project, issues);
  const parts = expander.expandList(
    model.parts,
    { file: asset.file, dir: asset.dir, idPrefix: '', materialMap: {}, stack: [] },
    'model.parts',
  );
  const attached = inheritAttachment(parts, {}, (id, message) => {
    const where = expander.origin(id);
    issues.push({ file: where.file || asset.file, path: where.path, message, code: 'bone_in_csg' });
  });
  const leaves: ExpandedLeaf[] = [];
  forEachLeaf(attached, (part) => leaves.push({ part, ...expander.origin(part.id) }));
  return { parts: attached, imports: expander.imports, componentMaterials: expander.componentMaterials, leaves };
}

type Attachment = Pick<PartDefinitionT, 'bone' | 'skin' | 'skinBones'>;

/**
 * Give every part its effective rig attachment: its own bone, skin and skinBones, or those
 * of the nearest group or component above it. A CSG result moves as one piece, so its
 * operands take the CSG part's attachment and may not set their own.
 */
function inheritAttachment(
  parts: readonly PartDefinitionT[],
  from: Attachment,
  report: (id: string, message: string) => void,
): PartDefinitionT[] {
  return parts.map((part) => {
    const own: Attachment = {
      ...(from.bone !== undefined ? { bone: from.bone } : {}),
      ...(from.skin !== undefined ? { skin: from.skin } : {}),
      ...(from.skinBones !== undefined ? { skinBones: from.skinBones } : {}),
      ...(part.bone !== undefined ? { bone: part.bone } : {}),
      ...(part.skin !== undefined ? { skin: part.skin } : {}),
      ...(part.skinBones !== undefined ? { skinBones: part.skinBones } : {}),
    };
    const node = { ...part, ...own } as PartDefinitionT;
    if (node.type === 'group') node.parts = inheritAttachment(node.parts, own, report);
    if (node.type === 'csg') {
      const strip = (p: PartDefinitionT): PartDefinitionT => {
        if (p.bone !== undefined || p.skin !== undefined || p.skinBones !== undefined) {
          report(
            p.id,
            `Part "${p.id}" is a CSG operand, so its bone and skin have no effect. Set them on the CSG part "${node.id}".`,
          );
        }
        const { bone: _b, skin: _s, skinBones: _k, ...rest } = p;
        const clean = { ...rest, ...own } as PartDefinitionT;
        if (clean.type === 'group' || clean.type === 'csg') clean.parts = clean.parts.map(strip);
        return clean;
      };
      node.parts = node.parts.map(strip);
    }
    return node;
  });
}

/** The material name a part with its own colour renders with. */
export function colourVariantName(material: string, partId: string): string {
  return `${material}~${partId}`;
}

/** Walk every leaf of an expanded model with its id. */
export function forEachLeaf(parts: readonly PartDefinitionT[], visit: (part: LeafPart) => void): void {
  for (const p of parts) {
    if (p.type === 'group' || p.type === 'csg') forEachLeaf(p.parts, visit);
    else if (p.type !== 'component') visit(p);
  }
}
