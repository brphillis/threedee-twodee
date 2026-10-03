import type { FrameSample, ResolvedDirectionT } from '@td2d/schema';

export const STATIC_CLIP = 'static';

export function frameKey(clip: string | null, direction: string, index: number): string {
  return `${clip ?? STATIC_CLIP}/${direction}/${String(index).padStart(3, '0')}`;
}

export interface SamplePlanInput {
  readonly directions: readonly Pick<ResolvedDirectionT, 'name' | 'yaw'>[];
  /** Clips with explicit sample times. Empty means one rest-pose frame per direction. */
  readonly clips: readonly { readonly name: string; readonly times: readonly number[] }[];
}

/** Samples in sheet order: clip, then direction, then frame. */
export function planSamples(input: SamplePlanInput): FrameSample[] {
  const samples: FrameSample[] = [];
  if (input.clips.length === 0) {
    for (const d of input.directions) samples.push({ key: frameKey(null, d.name, 0), clip: null, time: 0, yaw: d.yaw });
    return samples;
  }
  for (const clip of input.clips) {
    for (const d of input.directions) {
      clip.times.forEach((time, i) => {
        samples.push({ key: frameKey(clip.name, d.name, i), clip: clip.name, time, yaw: d.yaw });
      });
    }
  }
  return samples;
}

/** Evenly spaced sample times. Looping clips leave out the end so playback wraps cleanly. */
export function clipTimes(duration: number, frames: number, loop: boolean): number[] {
  if (frames <= 1) return [0];
  const step = loop ? duration / frames : duration / (frames - 1);
  return Array.from({ length: frames }, (_, i) => Number((i * step).toFixed(9)));
}
