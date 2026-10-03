// Phase 8 benchmark: 20 animated characters x 8 directions x 3 clips x 6 frames = 2880 samples.
//   pnpm bench                                   (writes build/bench.json)
//   BENCH_OUT=docs/roadmaps/assets/phase-11/bench.json pnpm bench
//   BENCH_CONCURRENCY=2 pnpm bench               (default: td2d batch's own default)
// Records wall time, peak memory of td2d and of the browser, and cache behaviour for a cold
// run, a warm rerun and a clip edit. Results that are kept for the record go in the phase's
// assets directory through BENCH_OUT; a plain run never overwrites them.
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { type BatchResult, loadProject, runBatch } from '@td2d/core';
import { character as benchCharacter } from './lib/bench-assets.ts';

const repo = join(import.meta.dirname, '..');
const out = resolve(repo, process.env.BENCH_OUT ?? join('build', 'bench.json'));
const root = mkdtempSync(join(tmpdir(), 'td2d-bench-'));
const tag = `bench-${process.pid}`;
process.env.TD2D_RUN_TAG = tag;
const ASSETS = 20;
const concurrency = process.env.BENCH_CONCURRENCY ? Number(process.env.BENCH_CONCURRENCY) : undefined;
const character = (i: number) => benchCharacter(i, ASSETS);

function write(dir: string, file: string, value: unknown) {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
}
write(root, 'td2d.project.json', { schemaVersion: '1.0.0', name: 'bench' });
for (let i = 0; i < ASSETS; i++)
  write(root, `assets/characters/c${String(i).padStart(2, '0')}/asset.json`, character(i));

const run = promisify(execFile);

/**
 * Resident memory of the browser processes started by this run, in MB. Asynchronous, so the
 * sampling never blocks the event loop of the batch it measures (Phase 8 ran `ps`
 * synchronously, which cost up to 2 s of a macOS run).
 */
async function browserMegabytes(): Promise<number> {
  try {
    const { stdout } = await run('ps', ['-ax', '-o', 'rss=,command='], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return Math.round(
      stdout
        .split('\n')
        .filter((r) => r.includes(`--td2d-run=${tag}`))
        .reduce((n, r) => n + Number(r.trim().split(/\s+/)[0]), 0) / 1024,
    );
  } catch {
    return 0;
  }
}

async function measure(label: string, work: () => Promise<BatchResult>) {
  let peakBrowser = 0;
  let sampling = true;
  // One sample at a time, 250 ms apart.
  const sampler = (async () => {
    while (sampling) {
      peakBrowser = Math.max(peakBrowser, await browserMegabytes());
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  const started = performance.now();
  const result = await work();
  const seconds = (performance.now() - started) / 1000;
  sampling = false;
  await sampler;
  if (result.error) throw result.error;
  const r = result.report;
  const samples = r.items.rendered + r.items.reused;
  return {
    label,
    seconds: Number(seconds.toFixed(1)),
    samples,
    rendered: r.items.rendered,
    reused: r.items.reused,
    samplesPerSecond: Number((r.items.rendered / seconds).toFixed(1)),
    stageCacheHitRatio: Number((r.cache.hits / Math.max(1, r.cache.hits + r.cache.misses)).toFixed(3)),
    itemReuseRatio: Number((r.items.reused / Math.max(1, samples)).toFixed(3)),
    peakTd2dMB: Math.round(process.resourceUsage().maxRSS / 1024),
    peakBrowserMB: peakBrowser,
    status: r.status,
    concurrency: r.options.concurrency,
    warnings: [...new Set(r.assets.flatMap((a) => a.warnings.map((w) => w.code)))],
  };
}

/** One asset of 512 samples (8 directions x 64 frames), in a fresh process so its peak memory is its own. */
async function large(): Promise<{ seconds: number; samples: number; peakTd2dMB: number }> {
  const asset = character(0);
  asset.animation = {
    fps: 16,
    clips: { walk: { duration: 4, generator: { type: 'walk-cycle', stride: 22, bob: 0.05 } } },
  } as never;
  rmSync(join(root, 'assets'), { recursive: true, force: true });
  write(root, 'assets/characters/long/asset.json', asset);
  const started = performance.now();
  const result = await runBatch({ project: loadProject(root), history: false });
  if (result.error) throw result.error;
  return {
    seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    samples: result.report.items.rendered,
    peakTd2dMB: Math.round(process.resourceUsage().maxRSS / 1024),
  };
}

if (process.env.BENCH_MODE === 'large') {
  try {
    process.stdout.write(`${JSON.stringify(await large())}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  process.exit(0);
}

try {
  const project = loadProject(root);
  const batch = () => runBatch({ project, ...(concurrency ? { concurrency } : {}), history: false });
  const cold = await measure('cold', batch);
  const warm = await measure('warm', batch);
  // Edit one key of the wave in every asset: only the frames between the edited keys change.
  for (let i = 0; i < ASSETS; i++) {
    const file = join(root, `assets/characters/c${String(i).padStart(2, '0')}/asset.json`);
    const asset = JSON.parse(readFileSync(file, 'utf8'));
    asset.animation.clips.wave.keys[1].pose.rightUpperArm.rotation = [0, 0, -120];
    writeFileSync(file, JSON.stringify(asset));
  }
  const edit = await measure('clip edit', batch);
  const largeRun = JSON.parse(
    execFileSync(process.execPath, [...process.execArgv, import.meta.filename], {
      env: { ...process.env, BENCH_MODE: 'large' },
      encoding: 'utf8',
    }).trim(),
  ) as { seconds: number; samples: number; peakTd2dMB: number };
  const result = {
    machine: {
      platform: `${process.platform}-${process.arch}`,
      cpus: cpus().length,
      cpu: cpus()[0]?.model ?? 'unknown',
      memoryGB: Math.round(totalmem() / 1024 ** 3),
      node: process.version,
    },
    assets: ASSETS,
    concurrency: cold.concurrency,
    runs: [cold, warm, edit].map(({ concurrency: _, ...run }) => run),
    largeAsset: {
      description: 'one asset, 8 directions x 64 frames at 4x supersample, in its own process',
      ...largeRun,
    },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
