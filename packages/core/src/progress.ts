/** Receives pipeline progress. The CLI renders it as NDJSON or as terminal lines. */
export interface ProgressReporter {
  stageStart(stage: string, info?: { readonly assetId?: string; readonly total?: number }): void;
  itemDone(
    stage: string,
    info: {
      readonly key: string;
      readonly n: number;
      readonly total: number;
      readonly assetId?: string;
      readonly status?: string;
    },
  ): void;
  stageDone(
    stage: string,
    info: { readonly durationMs: number; readonly cached: boolean; readonly assetId?: string },
  ): void;
}

export const silentProgress: ProgressReporter = {
  stageStart() {},
  itemDone() {},
  stageDone() {},
};
