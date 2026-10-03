import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  AssetDefinition,
  type ErrorDetailT,
  type ExportFormatT,
  type GenerationRecordT,
  issuesFromZod,
  OUTPUT_SCHEMA_VERSION,
  type ResolvedAssetT,
  type WarningT,
} from '@td2d/schema';
import { Td2dError, toTd2dError } from '../errors.ts';
import { cloneFile } from '../fs/copy.ts';
import { formatJson } from '../fs/json.ts';
import { relativePosix, resolveInside, toPosix } from '../fs/paths.ts';
import { type HistoryEntry, recordHistory } from '../history/history.ts';
import { type Logger, silentLogger } from '../logger.ts';
import { type ProgressReporter, silentProgress } from '../progress.ts';
import { type LoadedAsset, listAssetLocations, loadAsset } from '../project/assets.ts';
import { loadLibrary } from '../project/library.ts';
import { deepMerge } from '../project/merge.ts';
import type { Project } from '../project/project.ts';
import { resolveAsset } from '../project/resolve.ts';
import type { BackendInfo, BackendOptions, RenderBackend } from '../render/backend.ts';
import { checkFilter, type SampleFilter } from '../render/filter.ts';
import { OUTPUT_MARKER, prepareOutputDir } from '../render/output-dir.ts';
import { getBackend } from '../render/registry.ts';
import { CORE_VERSION } from '../version.ts';
import { createWorkerPool, type WorkerPool } from '../workers/pool.ts';
import { ItemCache, StageCache } from './cache.ts';
import { canonicalJson, hashValue, sha256Hex } from './hash.ts';
import { cleanCache, DEFAULT_CACHE_MAX_BYTES, listCacheEntries, parseSize, writeCacheIndex } from './maintenance.ts';
import {
  BUILD_LAYOUT,
  type ExportData,
  type PixelData,
  type PlanData,
  type RenderData,
  STAGE_NAMES,
  STAGES,
  type StageContext,
  type StageName,
  type ValidateData,
} from './stages.ts';

export interface GenerateOptions {
  readonly project: Project;
  /** Asset ids. Empty means every asset in the project. */
  readonly ids?: readonly string[];
  /** Recompute every stage. */
  readonly force?: boolean;
  /** Recompute this stage and everything after it. */
  readonly from?: StageName;
  /** Stop after this stage. */
  readonly to?: StageName;
  /** Neither read nor write the cache. */
  readonly noCache?: boolean;
  /** Report which stages would run without running anything. */
  readonly dryRun?: boolean;
  /** Treat validation warnings as failures. */
  readonly strict?: boolean;
  /** Record a history entry when the outputs changed. Default true. */
  readonly history?: boolean;
  readonly backendOptions?: BackendOptions;
  readonly logger?: Logger;
  readonly progress?: ProgressReporter;
  readonly signal?: AbortSignal;
  /**
   * Render only these samples. Other samples come from the render cache; a sample that is
   * neither selected nor cached fails the run with E_PARTIAL_PLAN.
   */
  readonly filter?: SampleFilter;
  /** With a filter: plan and render only the selected samples, and stop at render (td2d render). */
  readonly partialRender?: boolean;
  /** Worker threads for pixel processing and compositing. 0 runs everything in this thread. Default: up to 4. */
  readonly workers?: number;
  /** Make the render backend; for tests. Default: the registered backend. */
  readonly createBackend?: (id: string, options: BackendOptions) => RenderBackend;
  /** Write these export formats instead of the asset's own (td2d export --format). */
  readonly exportFormats?: readonly ExportFormatT[];
  /** Stop an asset that takes longer than this, with E_ASSET_TIMEOUT. The run goes on to the next asset. */
  readonly timeoutMs?: number;
  /** Set from timeoutMs: the performance.now() time by which the current asset must finish. */
  readonly deadline?: number;
  /**
   * Warn with W_MEMORY_HIGH when td2d's resident memory passes this after a stage. Default: the
   * TD2D_MEMORY_WARN_MB environment variable, or half the machine's memory, at most 4 GB.
   */
  readonly memoryWarnBytes?: number;
}

/** Where W_MEMORY_HIGH starts. */
export function memoryWarnBytes(options: Pick<GenerateOptions, 'memoryWarnBytes'>): number {
  if (options.memoryWarnBytes !== undefined) return options.memoryWarnBytes;
  const env = Number(process.env.TD2D_MEMORY_WARN_MB);
  if (Number.isFinite(env) && env > 0) return env * 1024 * 1024;
  return Math.min(4 * 1024 ** 3, totalmem() / 2);
}

export type StageStatus = 'cached' | 'ran' | 'would-run' | 'would-reuse' | 'skipped';

export interface StageReport {
  readonly name: StageName;
  readonly hash: string;
  readonly status: StageStatus;
  readonly durationMs: number;
}

export interface AssetGenerateResult {
  readonly assetId: string;
  readonly status: 'ok' | 'warn' | 'failed';
  readonly dryRun: boolean;
  readonly buildDir: string | null;
  readonly outputs: Readonly<Record<string, string>>;
  readonly validation: {
    readonly status: 'pass' | 'warn' | 'fail';
    readonly warnings: number;
    readonly errors: number;
  } | null;
  readonly stages: readonly StageReport[];
  readonly cache: { readonly hits: number; readonly misses: number };
  /** What this run did per item: samples rendered or restored, sprites processed or restored. */
  readonly items: {
    readonly render: { readonly rendered: number; readonly reused: number } | null;
    readonly pixel: { readonly processed: number; readonly reused: number } | null;
  };
  readonly backend: BackendInfo | null;
  /**
   * The scale and ground margin the sprites were drawn at: fitted values when the asset asks for
   * "auto", which can change when the model or the pixel settings change. Null when nothing was planned.
   */
  readonly scale: { readonly pixelsPerUnit: number; readonly groundMargin: number } | null;
  readonly history: HistoryEntry | null;
  readonly warnings: readonly WarningT[];
  readonly durationMs: number;
  readonly error?: ErrorDetailT;
}

interface StageResult {
  readonly dir: string;
  readonly data: unknown;
  readonly hash: string;
}

function stageHash(name: StageName, key: unknown, upstream: readonly string[]): string {
  const stage = STAGES.find((s) => s.name === name);
  return hashValue({ td2d: CORE_VERSION, stage: name, version: stage?.version ?? 0, key, upstream });
}

/** Stage hashes depend only on inputs, so a dry run can compute all of them without running anything. */
export function planStageHashes(
  asset: ResolvedAssetT,
  filter?: SampleFilter,
  partialRender = false,
): Record<StageName, string> {
  const hashes = {} as Record<StageName, string>;
  for (const stage of STAGES)
    hashes[stage.name] = stageHash(
      stage.name,
      stage.key({ asset, filter, partialRender }),
      stage.deps.map((d) => hashes[d]),
    );
  return hashes;
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.name !== 'meta.json' && entry.name !== OUTPUT_MARKER) out.push(toPosix(relative(base, full)));
  }
  return out.sort();
}

function readRecord(buildDir: string): GenerationRecordT | null {
  try {
    return JSON.parse(readFileSync(join(buildDir, 'generation.json'), 'utf8')) as GenerationRecordT;
  } catch {
    return null;
  }
}

type RecordedOutput = GenerationRecordT['outputs'][number];

/**
 * The stages whose directory in build/<id>/ already holds exactly this run's output, so a
 * rerun leaves it in place instead of copying every render and sprite again. A directory
 * counts only when the previous record has the same stage hash and the directory has the
 * same files as the cache entry, each with the size and SHA-256 the record lists; anything
 * edited, added or removed by hand means the stage is copied afresh. Returns the verified
 * files' record entries, so the new record need not read them again.
 */
function unchangedStages(
  buildDir: string,
  results: ReadonlyMap<StageName, StageResult>,
  previous: GenerationRecordT | null,
): { stages: Set<StageName>; outputs: Map<string, RecordedOutput> } {
  const stages = new Set<StageName>();
  const outputs = new Map<string, RecordedOutput>();
  if (!previous) return { stages, outputs };
  const stageHashes = new Map(previous.stages.map((s) => [s.name, s.hash]));
  const recorded = new Map(previous.outputs.map((o) => [o.path, o]));
  for (const [name, result] of results) {
    const layout = BUILD_LAYOUT[name];
    // Only stages that own a whole directory: the build root's files are few and cheap to copy.
    if (layout?.entries.length !== 1 || layout.entries[0] !== layout.dir) continue;
    if (stageHashes.get(name) !== `sha256:${result.hash}`) continue;
    const expected = listFiles(result.dir);
    const present = listFiles(join(buildDir, layout.dir));
    if (expected.length !== present.length || expected.some((f, i) => f !== present[i])) continue;
    const verified: RecordedOutput[] = [];
    for (const file of expected) {
      const path = `${layout.dir}/${file}`;
      const entry = recorded.get(path);
      if (!entry) break;
      const bytes = readFileSync(join(buildDir, path));
      if (bytes.length !== entry.bytes || `sha256:${sha256Hex(bytes)}` !== entry.sha256) break;
      verified.push(entry);
    }
    if (verified.length !== expected.length) continue;
    stages.add(name);
    for (const entry of verified) outputs.set(entry.path, entry);
  }
  return { stages, outputs };
}

/**
 * Update build/<id>/ with the outputs of this run. A full run replaces everything, except
 * stage directories that already hold exactly this run's output (see unchangedStages). A
 * partial run (--to) replaces the stages it ran, keeps later outputs whose stage hash
 * still matches the previous record, and removes later outputs that are now stale.
 * Only directories td2d marked are touched.
 */
function materialize(
  buildDir: string,
  results: ReadonlyMap<StageName, StageResult>,
  planned: Record<StageName, string>,
  full: boolean,
  previousRecord: GenerationRecordT | null,
): { kept: StageName[]; verified: Map<string, RecordedOutput> } {
  prepareOutputDir(buildDir);
  const kept: StageName[] = [];
  const unchanged = full
    ? unchangedStages(buildDir, results, previousRecord)
    : { stages: new Set<StageName>(), outputs: new Map<string, RecordedOutput>() };
  const keepEntries = new Set([...unchanged.stages].flatMap((name) => BUILD_LAYOUT[name]?.entries ?? []));
  if (full) {
    for (const entry of readdirSync(buildDir))
      if (entry !== OUTPUT_MARKER && entry !== PARTIAL_DIR && !keepEntries.has(entry))
        rmSync(join(buildDir, entry), { recursive: true, force: true });
  } else {
    const previous = new Map((previousRecord?.stages ?? []).map((s) => [s.name, s.hash]));
    for (const name of STAGE_NAMES) {
      const layout = BUILD_LAYOUT[name];
      const stillValid = !results.has(name) && previous.get(name) === `sha256:${planned[name]}`;
      if (stillValid) {
        kept.push(name);
        continue;
      }
      for (const entry of layout?.entries ?? []) rmSync(join(buildDir, entry), { recursive: true, force: true });
    }
  }
  // New outputs are copied into .partial first and then moved into place entry by entry, so
  // an interrupted run leaves .partial behind (discarded by the next run), never half-copied files.
  const partial = join(buildDir, PARTIAL_DIR);
  rmSync(partial, { recursive: true, force: true });
  const made = new Set<string>();
  for (const [name, result] of results) {
    const layout = BUILD_LAYOUT[name];
    if (!layout || unchanged.stages.has(name)) continue;
    const target = join(partial, layout.dir);
    for (const file of listFiles(result.dir)) {
      const to = join(target, file);
      const parent = dirname(to);
      if (!made.has(parent)) {
        mkdirSync(parent, { recursive: true });
        made.add(parent);
      }
      cloneFile(join(result.dir, file), to);
    }
  }
  if (existsSync(partial)) {
    for (const entry of readdirSync(partial)) {
      const from = join(partial, entry);
      const to = join(buildDir, entry);
      if (statSync(from).isDirectory() && existsSync(to) && statSync(to).isDirectory()) {
        // Shared directories such as the build root's own files: merge file by file.
        for (const file of listFiles(from)) {
          mkdirSync(join(to, file, '..'), { recursive: true });
          rmSync(join(to, file), { force: true });
          renameSync(join(from, file), join(to, file));
        }
      } else {
        rmSync(to, { recursive: true, force: true });
        renameSync(from, to);
      }
    }
    rmSync(partial, { recursive: true, force: true });
  }
  return { kept, verified: unchanged.outputs };
}

/** Inside build/<id>/: new outputs are staged here before they replace the old ones. */
export const PARTIAL_DIR = '.partial';

/** Shared by every asset of one run: caches, the temporary directory, backends and workers. */
export interface RunResources {
  readonly cache: StageCache | null;
  readonly tmpRoot: string;
  readonly workers: WorkerPool;
  backendFor(id: string): Promise<RenderBackend>;
  /** Stop backends and workers and remove the temporary directory. */
  close(aborted: boolean): Promise<void>;
}

/** Whether a process is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Remove temporary directories that earlier runs left behind (a crash or a kill), keeping
 * those of runs that are still going.
 */
export function cleanStaleTemp(project: Project): string[] {
  const root = join(project.root, '.td2d', 'tmp');
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    let owner: { pid?: number } = {};
    try {
      owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')) as { pid?: number };
    } catch {
      owner = {};
    }
    if (owner.pid !== undefined && owner.pid !== process.pid && alive(owner.pid)) continue;
    if (owner.pid === process.pid) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

/** Open the shared resources of a run. One render backend per id is shared, one render at a time. */
export function openRun(options: GenerateOptions): RunResources {
  const { project } = options;
  cleanStaleTemp(project);
  const cache = options.noCache ? null : new StageCache(project.paths.cache);
  const tmpRoot = join(project.root, '.td2d', 'tmp', randomUUID());
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    join(tmpRoot, 'owner.json'),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
  );
  const backends = new Map<string, RenderBackend>();
  const workers = createWorkerPool(options.workers);
  return {
    cache,
    tmpRoot,
    workers,
    async backendFor(id) {
      let backend = backends.get(id);
      if (!backend) {
        const backendOptions = { ...options.backendOptions, ...(options.logger ? { logger: options.logger } : {}) };
        backend = serialised(
          options.createBackend ? options.createBackend(id, backendOptions) : getBackend(id).create(backendOptions),
        );
        backends.set(id, backend);
      }
      return backend;
    },
    async close(aborted) {
      for (const backend of backends.values()) await backend.stop();
      if (aborted) await workers.destroy();
      else await workers.close();
      rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

/** A backend that runs one render at a time, so concurrent assets share one browser safely. */
function serialised(backend: RenderBackend): RenderBackend {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    id: backend.id,
    start: (signal) => enqueue(() => backend.start(signal)),
    render: (job, sink, options) => enqueue(() => backend.render(job, sink, options)),
    stop: () => backend.stop(),
  };
}

/** Run the pipeline for one asset with a run's shared resources. Throws when the asset fails before producing a result. */
export async function generateAsset(
  resources: RunResources,
  options: GenerateOptions,
  location: Parameters<typeof loadAsset>[1],
  overrides?: Readonly<Record<string, unknown>>,
): Promise<AssetGenerateResult> {
  const run = (opts: GenerateOptions) =>
    generateOne(
      opts.project,
      location,
      opts,
      resources.cache,
      resources.tmpRoot,
      (id) => resources.backendFor(id),
      resources.workers,
      overrides,
    );
  if (options.timeoutMs === undefined) return run(options);
  // Per-asset time limit: abort this asset's stages, not the run.
  const id = typeof location === 'string' ? location : location.id;
  // The timer aborts a long stage, such as a render, in the middle; the deadline is checked between
  // stages too, since quick stages can finish without the event loop ever reaching the timer.
  const timer = new AbortController();
  const handle = setTimeout(() => timer.abort(), options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timer.signal]) : timer.signal;
  try {
    return await run({ ...options, signal, deadline: performance.now() + options.timeoutMs });
  } catch (error) {
    if ((timer.signal.aborted || (error as { code?: string }).code === 'E_ASSET_TIMEOUT') && !options.signal?.aborted) {
      throw new Td2dError('E_ASSET_TIMEOUT', `${id} took longer than ${options.timeoutMs / 1000} s and was stopped.`, {
        hint: 'Raise --timeout, or render fewer directions or frames while iterating (--frames, --clips, --directions).',
        details: { timeoutMs: options.timeoutMs },
      });
    }
    throw error;
  } finally {
    clearTimeout(handle);
  }
}

/** Merge per-run overrides over an asset definition and check the result. */
function withOverrides(loaded: LoadedAsset, overrides: Readonly<Record<string, unknown>> | undefined): LoadedAsset {
  if (!overrides || Object.keys(overrides).length === 0) return loaded;
  const merged = deepMerge(loaded.definition, overrides);
  const parsed = AssetDefinition.safeParse(merged);
  if (!parsed.success) {
    throw new Td2dError('E_ASSET_INVALID', `The overrides for ${loaded.location.id} make an invalid asset.`, {
      issues: issuesFromZod(parsed.error, undefined, { input: merged, schema: AssetDefinition }).map((i) => ({
        ...i,
        path: i.path ? `overrides.${i.path}` : 'overrides',
      })),
    });
  }
  return { ...loaded, definition: parsed.data };
}

async function generateOne(
  project: Project,
  location: Parameters<typeof loadAsset>[1],
  options: GenerateOptions,
  cache: StageCache | null,
  tmpRoot: string,
  backendFor: (id: string) => Promise<RenderBackend>,
  workers: WorkerPool,
  overrides?: Readonly<Record<string, unknown>>,
): Promise<AssetGenerateResult> {
  const started = performance.now();
  const logger = options.logger ?? silentLogger;
  const progress = options.progress ?? silentProgress;
  const library = loadLibrary(project);
  const loaded = withOverrides(loadAsset(project, location), overrides);
  const resolved = resolveAsset(project, loaded, library);
  const asset: ResolvedAssetT = options.exportFormats
    ? { ...resolved.asset, export: { ...resolved.asset.export, formats: [...options.exportFormats] } }
    : resolved.asset;
  const resolveWarnings = resolved.warnings;
  const assetHash = `sha256:${sha256Hex(canonicalJson(asset))}`;
  checkFilter(options.filter, asset);
  if (
    options.filter &&
    options.partialRender &&
    STAGE_NAMES.indexOf(options.to ?? 'export') > STAGE_NAMES.indexOf('render')
  ) {
    throw new Td2dError('E_USAGE', 'A partial render stops at the render stage.', {
      hint: 'Use td2d render <id> with --clips, --directions or --frames.',
    });
  }
  const hashes = planStageHashes(asset, options.filter, options.partialRender === true);
  const stopAt = STAGE_NAMES.indexOf(options.to ?? 'export');
  const forceFrom = options.force ? 0 : options.from ? STAGE_NAMES.indexOf(options.from) : STAGE_NAMES.length;
  const reports: StageReport[] = [];
  const warnings: WarningT[] = [...library.warnings];

  if (options.dryRun) {
    for (const [i, name] of STAGE_NAMES.entries()) {
      const reusable = cache !== null && i < forceFrom && cache.read(name, hashes[name]) !== undefined;
      reports.push({
        name,
        hash: `sha256:${hashes[name]}`,
        status: i > stopAt ? 'skipped' : reusable ? 'would-reuse' : 'would-run',
        durationMs: 0,
      });
    }
    const counted = reports.filter((r) => r.status !== 'skipped');
    return {
      assetId: asset.id,
      status: 'ok',
      dryRun: true,
      buildDir: null,
      outputs: {},
      validation: null,
      stages: reports,
      cache: {
        hits: counted.filter((r) => r.status === 'would-reuse').length,
        misses: counted.filter((r) => r.status === 'would-run').length,
      },
      items: { render: null, pixel: null },
      backend: null,
      scale: null,
      history: null,
      warnings: resolveWarnings,
      durationMs: Math.round(performance.now() - started),
    };
  }

  const results = new Map<StageName, StageResult>();
  const ctx: StageContext = {
    asset,
    assetHash,
    projectRoot: project.root,
    resolveWarnings,
    logger,
    progress,
    signal: options.signal,
    filter: options.filter,
    partialRender: options.partialRender === true,
    items: cache ? new ItemCache(project.paths.cache) : null,
    forced: (stage) => STAGE_NAMES.indexOf(stage) >= forceFrom,
    workers,
    backend: () => backendFor(asset.render.backend),
    output<T>(stage: StageName) {
      const r = results.get(stage);
      if (!r) throw new Td2dError('E_INTERNAL', `Stage output "${stage}" is not available.`);
      return r as { dir: string; data: T; hash: string };
    },
  };

  const memoryLimit = memoryWarnBytes(options);
  for (const [i, stage] of STAGES.entries()) {
    if (i > stopAt) {
      reports.push({ name: stage.name, hash: `sha256:${hashes[stage.name]}`, status: 'skipped', durationMs: 0 });
      continue;
    }
    options.signal?.throwIfAborted();
    if (options.deadline !== undefined && performance.now() > options.deadline)
      throw new Td2dError('E_ASSET_TIMEOUT', `${asset.id} ran past its time limit.`);
    const hash = hashes[stage.name];
    const t0 = performance.now();
    progress.stageStart(stage.name, { assetId: asset.id });
    const hit =
      cache && i < forceFrom ? cache.read<{ data: unknown; warnings: WarningT[] }>(stage.name, hash) : undefined;
    if (hit) {
      results.set(stage.name, { dir: hit.dir, data: hit.meta.data.data, hash });
      warnings.push(...hit.meta.data.warnings);
      const durationMs = Math.round(performance.now() - t0);
      reports.push({ name: stage.name, hash: `sha256:${hash}`, status: 'cached', durationMs });
      progress.stageDone(stage.name, { durationMs, cached: true, assetId: asset.id });
      logger.debug('Stage reused from cache', { assetId: asset.id, stage: stage.name, hash });
      continue;
    }
    // Unique per run of the stage: concurrent assets can share a stage hash (a shared model).
    const dir = join(tmpRoot, `${stage.name}-${hash.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const outcome = await stage.run(ctx, dir);
    const durationMs = Math.round(performance.now() - t0);
    const stageWarnings = [...(outcome.warnings ?? [])];
    const finalDir = cache
      ? cache.commit(dir, {
          stage: stage.name,
          hash,
          createdAt: new Date().toISOString(),
          durationMs,
          data: { data: outcome.data, warnings: stageWarnings },
        })
      : dir;
    results.set(stage.name, { dir: finalDir, data: outcome.data, hash });
    warnings.push(...stageWarnings);
    const rss = process.memoryUsage().rss;
    if (rss > memoryLimit && !warnings.some((w) => w.code === 'W_MEMORY_HIGH')) {
      warnings.push({
        code: 'W_MEMORY_HIGH',
        assetId: asset.id,
        message: `td2d used ${Math.round(rss / 1024 / 1024)} MB of memory after the ${stage.name} stage, over the ${Math.round(memoryLimit / 1024 / 1024)} MB warning level.`,
        hint: 'Lower td2d batch --concurrency, or generate fewer directions or frames at once. TD2D_MEMORY_WARN_MB moves the warning level.',
      });
    }
    reports.push({ name: stage.name, hash: `sha256:${hash}`, status: 'ran', durationMs });
    progress.stageDone(stage.name, { durationMs, cached: false, assetId: asset.id });
    logger.debug('Stage ran', { assetId: asset.id, stage: stage.name, hash, durationMs });
  }

  const buildDir = resolveInside(project.paths.build, asset.id);
  const previousRecord = readRecord(buildDir);
  const { kept, verified } = materialize(buildDir, results, hashes, stopAt === STAGE_NAMES.length - 1, previousRecord);
  const keptStages = (previousRecord?.stages ?? []).filter((s) => kept.includes(s.name as StageName));

  const validationData = results.get('validate')?.data as ValidateData | undefined;
  const validation = validationData
    ? {
        status: validationData.status,
        warnings: validationData.checks.filter((c) => c.status === 'warn').length,
        errors: validationData.checks.filter((c) => c.status === 'fail').length,
      }
    : null;
  const failedChecks =
    validationData?.checks.filter((c) => c.status === 'fail' || (options.strict && c.status === 'warn')) ?? [];
  const error =
    failedChecks.length > 0
      ? new Td2dError(
          'E_VALIDATION_FAILED',
          `${asset.id} failed ${failedChecks.length} output check(s): ${failedChecks.map((c) => c.id).join(', ')}.`,
          {
            details: { checks: failedChecks },
            hint: `Read ${relativePosix(project.root, join(buildDir, 'validation.json'))} and adjust the asset.`,
          },
        )
      : undefined;
  const status: AssetGenerateResult['status'] = error
    ? 'failed'
    : warnings.length > 0 || validation?.status === 'warn'
      ? 'warn'
      : 'ok';
  const renderData = results.get('render')?.data as RenderData | undefined;
  const planData = results.get('plan')?.data as PlanData | undefined;
  const exportData = results.get('export')?.data as ExportData | undefined;
  const rel = (p: string) => relativePosix(project.root, join(buildDir, p));
  const outputs: Record<string, string> = { buildDir: relativePosix(project.root, buildDir) };
  if (results.has('model')) outputs.model = rel('model/model.glb');
  if (results.has('rig')) outputs.rig = rel('rig/model.glb');
  if (results.has('render')) outputs.renders = rel('renders');
  if (results.has('pixel')) outputs.sprites = rel('sprites');
  if (results.has('validate')) outputs.validation = rel('validation.json');
  if (exportData) {
    // The first sheet and its data; the manifest lists every sheet.
    outputs.sheet = rel(`sheets/${exportData.sheets[0]}`);
    const data = exportData.data[0];
    if (data) outputs.data = rel(`sheets/${data}`);
    outputs.manifest = rel(`sheets/${exportData.manifest}`);
  }
  outputs.generation = rel('generation.json');

  const finishedAt = new Date();
  const durationMs = Math.round(performance.now() - started);
  const record: GenerationRecordT = {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generator: { name: 'td2d', version: CORE_VERSION },
    assetId: asset.id,
    assetHash,
    startedAt: new Date(finishedAt.getTime() - durationMs).toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    status,
    backend: renderData
      ? { id: renderData.backend.id, version: renderData.backend.version, renderer: renderData.backend.renderer }
      : null,
    stages: [
      ...reports
        .filter((r) => r.status === 'ran' || r.status === 'cached')
        .map((r) => ({ name: r.name, hash: r.hash, cached: r.status === 'cached', durationMs: r.durationMs })),
      ...keptStages,
    ],
    outputs: listFiles(buildDir).map((file) => {
      const known = verified.get(file);
      if (known) return known;
      const bytes = readFileSync(join(buildDir, file));
      return { path: file, sha256: `sha256:${sha256Hex(bytes)}`, bytes: bytes.length };
    }),
    warnings,
    ...(error ? { error: error.toDetail() } : {}),
  };
  writeFileSync(join(buildDir, 'generation.json'), formatJson(record));

  const exportHash = results.get('export')?.hash;
  const history =
    exportHash && options.history !== false ? recordHistory(project, asset.id, buildDir, exportHash) : null;
  const counted = reports.filter((r) => r.status === 'ran' || r.status === 'cached');
  const ran = (stage: StageName) => reports.some((r) => r.name === stage && r.status === 'ran');
  const pixelData = results.get('pixel')?.data as PixelData | undefined;
  return {
    assetId: asset.id,
    status,
    dryRun: false,
    buildDir: relativePosix(project.root, buildDir),
    outputs,
    validation,
    stages: reports,
    cache: {
      hits: counted.filter((r) => r.status === 'cached').length,
      misses: counted.filter((r) => r.status === 'ran').length,
    },
    items: {
      render: renderData
        ? ran('render')
          ? renderData.items
          : { rendered: 0, reused: renderData.frames.length }
        : null,
      pixel: pixelData
        ? ran('pixel')
          ? pixelData.items
          : { processed: 0, reused: renderData?.frames.length ?? 0 }
        : null,
    },
    backend: renderData?.backend ?? null,
    scale: planData ? { pixelsPerUnit: planData.pixelsPerUnit, groundMargin: planData.groundMargin } : null,
    history,
    warnings,
    durationMs,
    ...(error ? { error: error.toDetail() } : {}),
  };
}

const ENVIRONMENT_ERRORS = new Set([
  'E_CANCELLED',
  'E_INTERNAL',
  'E_BROWSER_MISSING',
  'E_BACKEND_UNAVAILABLE',
  'E_NODE_VERSION',
  'E_NATIVE_MODULE',
]);

/**
 * Run the pipeline for each asset. Each asset succeeds or fails on its own; one render
 * backend is shared and stopped at the end.
 */
export async function generateAssets(options: GenerateOptions): Promise<AssetGenerateResult[]> {
  const { project } = options;
  const locations =
    options.ids && options.ids.length > 0
      ? options.ids.map((id) => ({ id }))
      : listAssetLocations(project).map((l) => ({ id: l.id }));
  if (locations.length === 0)
    throw new Td2dError('E_ASSET_NOT_FOUND', 'The project has no assets to generate.', {
      hint: 'Create one with `td2d asset create <id>`.',
    });
  const resources = openRun(options);
  const results: AssetGenerateResult[] = [];
  try {
    for (const { id } of locations) {
      options.signal?.throwIfAborted();
      try {
        results.push(await generateAsset(resources, options, id));
      } catch (error) {
        const failure = toTd2dError(error);
        // One asset reports its own error. Cancellation and environment problems stop a multi-asset run.
        if (locations.length === 1 || options.signal?.aborted || ENVIRONMENT_ERRORS.has(failure.code)) throw failure;
        results.push(failedResult(id, options, failure));
      }
    }
  } finally {
    await resources.close(options.signal?.aborted === true);
  }
  const pruned = pruneCache(project, options);
  if (pruned && results.length > 0) {
    const last = results.length - 1;
    results[last] = {
      ...(results[last] as AssetGenerateResult),
      warnings: [...(results[last] as AssetGenerateResult).warnings, pruned],
    };
  }
  return results;
}

/**
 * After a run: keep the cache under the project's cache.maxSize (default 5 GB), removing the
 * least recently used entries, and refresh the LRU index. Returns W_CACHE_PRUNED when it removed anything.
 */
export function pruneCache(project: Project, options: Pick<GenerateOptions, 'noCache' | 'dryRun'>): WarningT | null {
  if (options.noCache || options.dryRun || !existsSync(project.paths.cache)) return null;
  const limit = parseSize(project.config.cache?.maxSize ?? DEFAULT_CACHE_MAX_BYTES);
  const entries = listCacheEntries(project.paths.cache);
  const total = entries.reduce((n, e) => n + e.bytes, 0);
  if (total <= limit) {
    writeCacheIndex(project.paths.cache, entries);
    return null;
  }
  const result = cleanCache(project.paths.cache, { maxBytes: limit });
  return {
    code: 'W_CACHE_PRUNED',
    message: `The cache reached ${Math.round(total / 1024 / 1024)} MB, over its ${Math.round(limit / 1024 / 1024)} MB limit, so ${result.removed} least recently used entries were removed.`,
    hint: 'Raise cache.maxSize in td2d.project.json, or run td2d cache clean.',
  };
}

/** The result recorded for an asset that failed before producing one. */
export function failedResult(
  assetId: string,
  options: Pick<GenerateOptions, 'dryRun'>,
  failure: Td2dError,
): AssetGenerateResult {
  return {
    assetId,
    status: 'failed',
    dryRun: options.dryRun === true,
    buildDir: null,
    outputs: {},
    validation: null,
    stages: [],
    cache: { hits: 0, misses: 0 },
    items: { render: null, pixel: null },
    backend: null,
    scale: null,
    history: null,
    warnings: [],
    durationMs: 0,
    error: failure.toDetail(),
  };
}

/** Errors that stop a multi-asset run instead of failing one asset. */
export function stopsRun(code: string): boolean {
  return ENVIRONMENT_ERRORS.has(code);
}
