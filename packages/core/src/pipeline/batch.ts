import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BatchManifest,
  type BatchManifestT,
  BatchReport,
  type BatchReportT,
  issuesFromZod,
  OUTPUT_SCHEMA_VERSION,
} from '@td2d/schema';
import { Td2dError, toTd2dError } from '../errors.ts';
import { formatJson } from '../fs/json.ts';
import { relativePosix } from '../fs/paths.ts';
import { listAssetLocations } from '../project/assets.ts';
import { CORE_VERSION } from '../version.ts';
import {
  type AssetGenerateResult,
  failedResult,
  type GenerateOptions,
  generateAsset,
  openRun,
  pruneCache,
  stopsRun,
} from './generate.ts';

export interface BatchOptions extends Omit<GenerateOptions, 'ids' | 'filter' | 'partialRender'> {
  /** Asset id glob (td2d batch --filter): * matches within a segment, ** across segments. */
  readonly match?: string;
  /** A batch manifest and the file it came from. */
  readonly manifest?: { readonly file: string; readonly data: BatchManifestT };
  /** Assets generated at once. Default 2. */
  readonly concurrency?: number;
  /** Run every asset even after failures, and exit 6 if any failed. */
  readonly continueOnError?: boolean;
  /** Cancel assets already running when one fails. */
  readonly failFast?: boolean;
  /** An earlier report: assets that succeeded in it are skipped. */
  readonly resume?: { readonly file: string; readonly data: BatchReportT };
  /** Where to write the report. Default build/batch-report.json. */
  readonly reportFile?: string;
}

export interface BatchResult {
  readonly report: BatchReportT;
  readonly reportFile: string;
  readonly results: readonly AssetGenerateResult[];
  /** Set when the batch did not fully succeed: E_BATCH_PARTIAL, E_BATCH_FAILED or E_CANCELLED. */
  readonly error?: Td2dError;
}

/** Match an asset id against a glob: * within one segment, ** across segments, ? one character. */
/**
 * Assets generated at once when neither --concurrency nor the manifest says: one fewer than
 * the cores, at most 4. Every asset shares one browser, which renders one asset at a time, so
 * lanes beyond about 3 only overlap more pixel and sheet work: on the Phase 11 benchmark
 * (10 cores) 3 lanes ran the cold batch in 13.3 s and 9 lanes in 13.1 s, with 11 percent more
 * memory. The cap keeps memory flat on machines with many cores.
 */
export function defaultConcurrency(cores = availableParallelism()): number {
  return Math.max(1, Math.min(4, cores - 1));
}

export function matchesGlob(id: string, glob: string): boolean {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else pattern += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`).test(id);
}

/** Read and check a batch manifest file. */
export function readBatchManifest(file: string, display: string): BatchManifestT {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Td2dError('E_USAGE', `${display} is not readable JSON: ${(error as Error).message}`);
  }
  const parsed = BatchManifest.safeParse(raw);
  if (!parsed.success) {
    throw new Td2dError('E_ASSET_INVALID', `${display} is not a valid batch manifest.`, {
      file: display,
      issues: issuesFromZod(parsed.error, display, { input: raw, schema: BatchManifest }),
    });
  }
  return parsed.data;
}

/** Read an earlier batch report for --resume. */
export function readBatchReport(file: string, display: string): BatchReportT {
  try {
    return BatchReport.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Td2dError('E_USAGE', `${display} is not a td2d batch report.`, {
      hint: (error as Error).message.split('\n')[0] ?? '',
    });
  }
}

/**
 * Generate many assets: a glob or a manifest picks them, up to `concurrency` run at once
 * sharing one browser and one worker pool, and every asset's outcome goes into the batch
 * report. A failure stops new assets from starting unless continueOnError; failFast also
 * cancels the ones already running.
 */
export async function runBatch(options: BatchOptions): Promise<BatchResult> {
  const { project } = options;
  const started = new Date();
  const known = listAssetLocations(project).map((l) => l.id);
  let entries: { id: string; overrides?: Record<string, unknown> }[];
  if (options.manifest) {
    entries = options.manifest.data.assets.map((a) => ({
      id: a.id,
      ...(a.overrides ? { overrides: a.overrides } : {}),
    }));
    const missing = entries.filter((e) => !known.includes(e.id));
    if (missing.length > 0) {
      throw new Td2dError(
        'E_ASSET_NOT_FOUND',
        `${options.manifest.file} lists ${missing.length} asset(s) that do not exist: ${missing.map((m) => m.id).join(', ')}.`,
      );
    }
  } else {
    entries = known.map((id) => ({ id }));
  }
  if (options.match) entries = entries.filter((e) => matchesGlob(e.id, options.match as string));
  if (entries.length === 0) {
    throw new Td2dError(
      'E_ASSET_NOT_FOUND',
      options.match ? `No assets match "${options.match}".` : 'The batch has no assets.',
      {
        hint: 'Run `td2d asset list` to see the asset ids.',
      },
    );
  }
  const manifestOptions = options.manifest?.data.options ?? {};
  const concurrency = Math.max(1, options.concurrency ?? manifestOptions.concurrency ?? defaultConcurrency());
  const continueOnError = options.continueOnError ?? manifestOptions.continueOnError ?? false;
  const failFast = options.failFast ?? manifestOptions.failFast ?? false;
  const strict = options.strict ?? manifestOptions.strict ?? false;
  const resumed = new Set(
    (options.resume?.data.assets ?? []).filter((a) => a.status === 'ok' || a.status === 'warn').map((a) => a.assetId),
  );

  // Fail-fast cancels running assets through this controller; the caller's signal cancels everything.
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const runOptions: GenerateOptions = { ...options, strict, signal };
  const resources = openRun(runOptions);
  const outcomes = new Map<string, AssetGenerateResult | { skipped: 'resumed' | 'stopped' | 'cancelled' }>();
  let failed = false;
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++] as (typeof entries)[number];
      if (resumed.has(entry.id)) {
        outcomes.set(entry.id, { skipped: 'resumed' });
        continue;
      }
      if (options.signal?.aborted) {
        outcomes.set(entry.id, { skipped: 'cancelled' });
        continue;
      }
      if (failed && !continueOnError) {
        outcomes.set(entry.id, { skipped: 'stopped' });
        continue;
      }
      try {
        const result = await generateAsset(resources, runOptions, entry.id, entry.overrides);
        outcomes.set(entry.id, result);
        if (result.status === 'failed') failed = true;
      } catch (error) {
        const failure = toTd2dError(error);
        if (options.signal?.aborted) {
          outcomes.set(entry.id, { skipped: 'cancelled' });
          continue;
        }
        if (stop.signal.aborted && failure.code === 'E_CANCELLED') {
          outcomes.set(entry.id, { skipped: 'stopped' });
          continue;
        }
        outcomes.set(entry.id, failedResult(entry.id, runOptions, failure));
        failed = true;
        if (stopsRun(failure.code) && failure.code !== 'E_CANCELLED') stop.abort(failure);
      }
      if (failed && failFast && !continueOnError)
        stop.abort(new Td2dError('E_BATCH_FAILED', 'Stopping the batch after a failure.'));
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
  } finally {
    await resources.close(signal.aborted);
  }
  const pruned = pruneCache(project, options);

  const results = entries
    .map((e) => outcomes.get(e.id))
    .filter((o): o is AssetGenerateResult => o !== undefined && 'assetId' in o);
  const assets: BatchReportT['assets'] = entries.map((e) => {
    const o = outcomes.get(e.id) ?? { skipped: 'cancelled' as const };
    if (!('assetId' in o)) return { assetId: e.id, status: 'skipped', skipped: o.skipped, durationMs: 0, warnings: [] };
    return {
      assetId: o.assetId,
      status: o.status,
      durationMs: o.durationMs,
      ...(o.error ? { error: o.error } : {}),
      warnings: [...o.warnings],
      ...(Object.keys(o.outputs).length > 0 ? { outputs: { ...o.outputs } } : {}),
      cache: { ...o.cache },
      items: {
        render: o.items.render ? { ...o.items.render } : null,
        pixel: o.items.pixel ? { ...o.items.pixel } : null,
      },
    };
  });
  const count = (status: string) => assets.filter((a) => a.status === status).length;
  const cancelled = options.signal?.aborted === true;
  const status: BatchReportT['status'] = cancelled
    ? 'cancelled'
    : count('failed') === 0
      ? count('warn') > 0
        ? 'warn'
        : 'ok'
      : continueOnError
        ? 'partial'
        : 'failed';
  const finished = new Date();
  const report: BatchReportT = {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generator: { name: 'td2d', version: CORE_VERSION },
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    status,
    options: {
      filter: options.match ?? null,
      manifest: options.manifest?.file ?? null,
      concurrency,
      continueOnError,
      failFast,
      resumedFrom: options.resume?.file ?? null,
    },
    totals: { ok: count('ok'), warn: count('warn'), failed: count('failed'), skipped: count('skipped') },
    cache: {
      hits: results.reduce((n, r) => n + r.cache.hits, 0),
      misses: results.reduce((n, r) => n + r.cache.misses, 0),
    },
    items: {
      rendered: results.reduce((n, r) => n + (r.items.render?.rendered ?? 0), 0),
      reused: results.reduce((n, r) => n + (r.items.render?.reused ?? 0), 0),
    },
    assets,
  };
  if (pruned) {
    const last = report.assets.findLast((a) => a.status !== 'skipped');
    if (last) last.warnings.push(pruned);
  }
  const reportFile = options.reportFile ?? join(project.paths.build, 'batch-report.json');
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, formatJson(BatchReport.parse(report)));
  const display = relativePosix(project.root, reportFile);
  const failures = assets.filter((a) => a.status === 'failed');
  const details = {
    report: display,
    failed: failures.map((f) => ({ assetId: f.assetId, code: f.error?.code, message: f.error?.message })),
  };
  const error = cancelled
    ? new Td2dError('E_CANCELLED', 'The batch was cancelled.', {
        hint: `Resume it with td2d batch --resume ${display}.`,
        details,
      })
    : failures.length === 0
      ? undefined
      : continueOnError
        ? new Td2dError('E_BATCH_PARTIAL', `${failures.length} of ${assets.length} assets failed.`, {
            hint: `Read ${display}. Fix them and run td2d batch --resume ${display}.`,
            details,
          })
        : new Td2dError(
            'E_BATCH_FAILED',
            `${failures[0]?.assetId} failed, so the batch stopped (${count('skipped')} asset(s) not run).`,
            {
              hint: `Read ${display}. Use --continue-on-error to run the rest, or fix it and run td2d batch --resume ${display}.`,
              details,
            },
          );
  return { report, reportFile, results, ...(error ? { error } : {}) };
}
