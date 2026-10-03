// Animation timing. No DOM: the scheduler is injected so tests drive it with fake timers.

export const LOOP_MODES = ['loop', 'ping-pong', 'once'] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

/**
 * Turns elapsed time into whole frames at a fixed rate. Time left over after a frame carries to
 * the next call, so the long-run rate is exact whatever the display's refresh rate.
 */
export class FrameClock {
  private carry = 0;
  private period: number;

  constructor(fps: number) {
    this.period = 1000 / FrameClock.check(fps);
  }

  private static check(fps: number): number {
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be positive, got ${fps}`);
    return fps;
  }

  get fps(): number {
    return 1000 / this.period;
  }

  setFps(fps: number): void {
    this.period = 1000 / FrameClock.check(fps);
    this.carry = Math.min(this.carry, this.period);
  }

  reset(): void {
    this.carry = 0;
  }

  /** Add `ms` of elapsed time and return how many frames it completes. */
  advance(ms: number): number {
    if (!(ms > 0)) return 0;
    this.carry += ms;
    // The epsilon absorbs floating point error, so 10 x 100 ms is exactly 10 frames at 10 fps.
    const frames = Math.floor(this.carry / this.period + 1e-9);
    this.carry = Math.max(0, this.carry - frames * this.period);
    return frames;
  }
}

/** The frame shown `tick` frames after the start of a clip of `frames` frames. */
export function frameAt(tick: number, frames: number, mode: LoopMode): number {
  if (frames <= 1) return 0;
  const t = Math.max(0, Math.floor(tick));
  if (mode === 'once') return Math.min(t, frames - 1);
  if (mode === 'loop') return t % frames;
  // Ping-pong: 0 1 2 3 2 1 0 1 ..., not repeating the end frames.
  const period = 2 * (frames - 1);
  const p = t % period;
  return p < frames ? p : period - p;
}

/** Whether a once-only clip has reached its last frame at `tick`. */
export function finished(tick: number, frames: number, mode: LoopMode): boolean {
  return mode === 'once' && tick >= frames - 1;
}

export interface Scheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrames: Scheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Call `onFrames(n)` whenever `n` whole frames have elapsed at `fps`, until the returned stop
 * function is called. A gap of more than `maxGapMs` (a background tab) counts as one frame.
 */
export function startPlayback(options: {
  fps: number;
  onFrames: (frames: number) => void;
  scheduler?: Scheduler;
  maxGapMs?: number;
}): () => void {
  const scheduler = options.scheduler ?? animationFrames;
  const clock = new FrameClock(options.fps);
  const maxGap = options.maxGapMs ?? 1000;
  let last: number | null = null;
  let handle = 0;
  let stopped = false;
  const tick = (time: number) => {
    if (stopped) return;
    if (last !== null) {
      const gap = time - last;
      const frames = gap > maxGap ? 1 : clock.advance(gap);
      if (gap > maxGap) clock.reset();
      if (frames > 0) options.onFrames(frames);
    }
    last = time;
    if (!stopped) handle = scheduler.request(tick);
  };
  handle = scheduler.request(tick);
  return () => {
    stopped = true;
    scheduler.cancel(handle);
  };
}
