import type { FrameSample, ModelInfo, RenderSceneSettings } from '@td2d/schema';
import type { Logger } from '../logger.ts';

export interface RenderJob {
  readonly model: { readonly glb: Uint8Array; readonly label?: string };
  readonly scene: RenderSceneSettings;
  readonly samples: readonly FrameSample[];
}

/** A rendered frame in Node: RGBA rows top-down, straight (not premultiplied) alpha. */
export interface RenderedFrame {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** View-space normals as RGBA rows top-down, when the job asked for them. */
  readonly normals?: Uint8Array;
}

export type FrameSink = (frame: RenderedFrame, index: number) => Promise<void> | void;

export interface BackendInfo {
  readonly id: string;
  /** Browser or library version. */
  readonly version: string;
  /** GPU renderer string reported by WebGL. */
  readonly renderer: string;
  /** True when rendering uses a software rasteriser with reproducible output. */
  readonly software: boolean;
  readonly harnessVersion: string;
  readonly threeRevision: string;
}

export interface RenderTimings {
  readonly loadMs: number;
  readonly renderMs: number;
}

export interface RenderSummary {
  readonly frames: number;
  readonly model: ModelInfo;
  readonly timings: RenderTimings;
}

export interface RenderOptions {
  readonly signal?: AbortSignal;
  readonly onFrame?: (info: { key: string; n: number; total: number }) => void;
}

/** A way of turning a GLB plus samples into RGBA frames. Rendering code outside this interface never touches three.js. */
export interface RenderBackend {
  readonly id: string;
  start(signal?: AbortSignal): Promise<BackendInfo>;
  render(job: RenderJob, sink: FrameSink, options?: RenderOptions): Promise<RenderSummary>;
  stop(): Promise<void>;
}

export interface BackendOptions {
  readonly logger?: Logger;
  /** Use the GPU if one is available. Faster, but output then depends on the machine. */
  readonly allowHardware?: boolean;
  /** Samples per round trip to the renderer. */
  readonly batchSize?: number;
  /** Longest a single batch may take before the render fails. */
  readonly batchTimeoutMs?: number;
}

export interface BackendDescriptor {
  readonly id: string;
  readonly description: string;
  /** Everything outside the job that can change the pixels, such as library and harness versions. Part of the render cache key. */
  fingerprint(): Record<string, string>;
  create(options?: BackendOptions): RenderBackend;
}
