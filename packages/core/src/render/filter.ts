import type { FrameSample, ResolvedAssetT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';

/** One --frames selector: clip, direction and an inclusive frame range, each possibly "*". */
export interface FrameSelector {
  readonly clip: string;
  readonly direction: string;
  readonly from: number;
  readonly to: number;
}

/** Which samples to render. Each list narrows the set; omitted lists allow everything. */
export interface SampleFilter {
  readonly clips?: readonly string[];
  readonly directions?: readonly string[];
  readonly frames?: readonly FrameSelector[];
}

/**
 * Parse "clip/dir/range": walk/s/0-2, walk/s/3, walk/star/star with "*" for any clip,
 * direction or frame. Frames count from 0.
 */
export function parseFrameSelector(text: string): FrameSelector {
  const match = /^([a-z][a-z0-9_]*|\*)\/([a-z][a-z0-9-]*|\*)\/(\*|\d+(?:-\d+)?)$/.exec(text.trim());
  if (!match) {
    throw new Td2dError('E_USAGE', `"${text}" is not a frame selector.`, {
      hint: 'Use clip/direction/frames, such as walk/s/0-2, walk/*/3 or idle/*/*.',
    });
  }
  const [, clip, direction, range] = match as unknown as [string, string, string, string];
  if (range === '*') return { clip, direction, from: 0, to: Number.POSITIVE_INFINITY };
  const [a, b] = range.split('-').map(Number) as [number, number | undefined];
  const to = b ?? a;
  if (to < a)
    throw new Td2dError('E_USAGE', `Frame range "${range}" runs backwards.`, {
      hint: 'Write the lower frame first, as in 0-2.',
    });
  return { clip, direction, from: a, to };
}

/** A canonical form of a filter for cache keys, or null when it allows everything. */
export function filterKey(filter: SampleFilter | undefined): unknown {
  if (!filter || (!filter.clips && !filter.directions && !filter.frames)) return null;
  return {
    clips: filter.clips ? [...filter.clips].sort() : null,
    directions: filter.directions ? [...filter.directions].sort() : null,
    frames: filter.frames ? filter.frames.map((f) => `${f.clip}/${f.direction}/${f.from}-${f.to}`).sort() : null,
  };
}

/** Throw E_USAGE when a filter names clips or directions the asset does not have. */
export function checkFilter(
  filter: SampleFilter | undefined,
  asset: Pick<ResolvedAssetT, 'id' | 'animation' | 'directions'>,
): void {
  if (!filter) return;
  const clips = Object.keys(asset.animation.clips);
  const directions = asset.directions.map((d) => d.name);
  const unknown = (kind: string, name: string, known: string[]) =>
    new Td2dError('E_USAGE', `"${asset.id}" has no ${kind} "${name}".`, {
      hint: `${kind === 'clip' ? 'Clips' : 'Directions'}: ${known.join(', ')}.`,
    });
  for (const c of [...(filter.clips ?? []), ...(filter.frames ?? []).map((f) => f.clip).filter((c) => c !== '*')]) {
    if (!clips.includes(c)) throw unknown('clip', c, clips);
  }
  for (const d of [
    ...(filter.directions ?? []),
    ...(filter.frames ?? []).map((f) => f.direction).filter((d) => d !== '*'),
  ]) {
    if (!directions.includes(d)) throw unknown('direction', d, directions);
  }
}

/** The samples a filter keeps. Sample keys are clip/direction/nnn. */
export function applyFilter(samples: readonly FrameSample[], filter: SampleFilter | undefined): FrameSample[] {
  if (!filter) return [...samples];
  return samples.filter((s) => {
    const [clip, direction, index] = s.key.split('/') as [string, string, string];
    const frame = Number(index);
    if (filter.clips && !filter.clips.includes(clip)) return false;
    if (filter.directions && !filter.directions.includes(direction)) return false;
    if (filter.frames) {
      return filter.frames.some(
        (f) =>
          (f.clip === '*' || f.clip === clip) &&
          (f.direction === '*' || f.direction === direction) &&
          frame >= f.from &&
          frame <= f.to,
      );
    }
    return true;
  });
}
