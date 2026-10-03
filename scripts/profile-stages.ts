// Runs the benchmark's cold batch once and prints where the time went, stage by stage, summed
// over every asset, plus the renderer's own load and render timings.
//   node --conditions=td2d-source scripts/profile-stages.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProject, runBatch } from '@td2d/core';
import type { GenerationRecordT } from '@td2d/schema';
import { character } from './lib/bench-assets.ts';

const root = mkdtempSync(join(tmpdir(), 'td2d-profile-'));
const write = (file: string, value: unknown) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), JSON.stringify(value));
};
try {
  write('td2d.project.json', { schemaVersion: '1.0.0', name: 'profile' });
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const id = `characters/c${String(i).padStart(2, '0')}`;
    ids.push(id);
    write(`assets/${id}/asset.json`, character(i, 20));
  }
  const started = performance.now();
  const result = await runBatch({
    project: loadProject(root),
    ...(process.env.BENCH_CONCURRENCY ? { concurrency: Number(process.env.BENCH_CONCURRENCY) } : {}),
    history: false,
  });
  const total = (performance.now() - started) / 1000;
  if (result.error) throw result.error;
  const sums = new Map<string, number>();
  for (const id of ids) {
    const record = JSON.parse(readFileSync(join(root, 'build', id, 'generation.json'), 'utf8')) as GenerationRecordT;
    for (const s of record.stages) sums.set(s.name, (sums.get(s.name) ?? 0) + s.durationMs);
  }
  process.stdout.write(`wall ${total.toFixed(1)} s\n`);
  for (const [name, ms] of sums) process.stdout.write(`  ${name.padEnd(9)} ${(ms / 1000).toFixed(2)} s\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
