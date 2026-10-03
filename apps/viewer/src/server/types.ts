// Shapes the viewer server sends and the client reads. Plain types only: no runtime code.
import type { GenerationRecordT, ManifestT, ResolvedAssetT, ValidationReportT } from '@td2d/schema';

export interface AssetSummary {
  readonly id: string;
  readonly generatedAt: string;
  readonly frame: ManifestT['frame'];
  readonly pivot: ManifestT['pivot'];
  /** Base URL of the asset's build directory. */
  readonly files: string;
  readonly sheets: number;
  /** The first cell of the first clip, for a thumbnail. */
  readonly thumbnail: {
    readonly image: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly offset: { readonly x: number; readonly y: number };
  } | null;
  readonly cells: number;
  readonly directions: readonly string[];
  readonly clips: readonly string[];
  readonly tags: readonly string[];
  readonly type: string | null;
  readonly validation: ManifestT['validation']['status'];
  readonly warnings: number;
  readonly errors: number;
}

export interface ViewerIndex {
  readonly mode: 'server' | 'static';
  readonly project: { readonly name: string };
  readonly generatedAt: string;
  readonly assets: readonly AssetSummary[];
}

export interface HistorySummary {
  readonly id: string;
  readonly createdAt: string;
  /** First 12 hex digits of the export stage hash of that generation. */
  readonly hash: string;
  readonly validation: ValidationReportT['status'] | null;
  /** Base URL of the entry: it holds sheets/ and validation.json. */
  readonly files: string;
}

/** Settings from resolved.json the viewer shows. */
export interface ResolvedSummary {
  readonly camera: ResolvedAssetT['camera'];
  readonly lighting: ResolvedAssetT['lighting'];
  readonly pixel: ResolvedAssetT['pixel'];
  readonly sheet: ResolvedAssetT['sheet'];
  readonly rig: { readonly preset: string | null; readonly bones: number } | null;
  readonly materials: ResolvedAssetT['materials'];
}

export interface AssetDetail {
  readonly id: string;
  readonly files: string;
  readonly manifest: ManifestT;
  readonly validation: ValidationReportT | null;
  readonly generation: GenerationRecordT | null;
  readonly resolved: ResolvedSummary | null;
  /** Whether build/<id>/rig/model.glb exists, for the 3D preview. */
  readonly model: string | null;
  readonly history: readonly HistorySummary[];
}

/** One history entry: the copied sheets plus the validation and generation records. */
export interface HistoryDetail {
  readonly id: string;
  readonly entry: string;
  readonly files: string;
  readonly manifest: ManifestT;
  readonly validation: ValidationReportT | null;
  readonly generation: GenerationRecordT | null;
}

export interface ChangeEvent {
  /** Asset ids whose build changed, or ["*"] when the whole index should reload. */
  readonly assets: readonly string[];
  readonly at: string;
}
