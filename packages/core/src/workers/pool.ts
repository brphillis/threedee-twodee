import { availableParallelism } from 'node:os';
import { Piscina } from 'piscina';
import type { RgbaImage } from '../pixel/image.ts';
import { type CompositeTask, type PixelTask, type PixelTaskResult, runTask } from './tasks.ts';

/** Fewer frames than this run inline: starting a worker costs more than it saves. */
export const INLINE_BELOW = 48;

export interface WorkerPool {
  readonly size: number;
  pixel(task: Omit<PixelTask, 'kind'>, signal?: AbortSignal): Promise<PixelTaskResult>;
  composite(task: Omit<CompositeTask, 'kind'>, signal?: AbortSignal): Promise<RgbaImage>;
  /** Finish queued work, then stop the threads. */
  close(): Promise<void>;
  /** Stop the threads at once, abandoning queued work. */
  destroy(): Promise<void>;
}

const fromSource = import.meta.url.endsWith('.ts');

/**
 * A pool of worker threads for pixel processing and sheet compositing, started on first
 * use. Small jobs run inline. `size` 0 runs everything inline.
 */
export function createWorkerPool(size = Math.max(1, Math.min(4, availableParallelism() - 1))): WorkerPool {
  let piscina: Piscina | undefined;
  const get = () => {
    piscina ??= new Piscina({
      filename: new URL(fromSource ? './worker.ts' : './worker.js', import.meta.url).href,
      minThreads: 0,
      maxThreads: size,
      idleTimeout: 2000,
      // Running from source: workers must resolve workspace packages to their sources too.
      execArgv:
        fromSource && !process.execArgv.includes('--conditions=td2d-source')
          ? [...process.execArgv, '--conditions=td2d-source']
          : process.execArgv,
    });
    return piscina;
  };
  const run = async <T>(task: PixelTask | CompositeTask, frames: number, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
    if (size === 0 || frames < INLINE_BELOW) return runTask(task) as T;
    return (await get().run(task, signal ? { signal } : {})) as T;
  };
  return {
    size,
    pixel: (task, signal) => run<PixelTaskResult>({ kind: 'pixel', ...task }, task.frames.length, signal),
    composite: (task, signal) => run<RgbaImage>({ kind: 'composite', ...task }, task.sprites.length, signal),
    async close() {
      if (piscina) await piscina.close();
      piscina = undefined;
    },
    async destroy() {
      if (piscina) await piscina.destroy();
      piscina = undefined;
    },
  };
}
