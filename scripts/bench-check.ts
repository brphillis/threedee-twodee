// Checks a benchmark result against the Phase 8 targets: 2880 samples rendered cold in under
// 4 minutes, td2d under 1 GB, and a 512-sample asset under 500 MB in its own process.
//   node scripts/bench-check.ts [bench.json]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Run {
  readonly label: string;
  readonly seconds: number;
  readonly samples: number;
  readonly rendered: number;
  readonly peakTd2dMB: number;
}
interface Bench {
  readonly runs: readonly Run[];
  readonly largeAsset: { readonly samples: number; readonly peakTd2dMB: number; readonly seconds: number };
}

const file = process.argv[2] ?? join(import.meta.dirname, '..', 'build', 'bench.json');
const bench = JSON.parse(readFileSync(file, 'utf8')) as Bench;
const cold = bench.runs.find((r) => r.label === 'cold');
const warm = bench.runs.find((r) => r.label === 'warm');
const problems: string[] = [];
if (!cold || !warm) problems.push('The result has no cold or warm run.');
if (cold && cold.rendered !== 2880) problems.push(`The cold run rendered ${cold.rendered} samples, not 2880.`);
if (cold && cold.seconds > 240) problems.push(`The cold run took ${cold.seconds} s, over the 240 s target.`);
for (const r of bench.runs)
  if (r.peakTd2dMB > 1024) problems.push(`The ${r.label} run peaked at ${r.peakTd2dMB} MB, over 1 GB.`);
if (warm && warm.rendered !== 0)
  problems.push(`The warm rerun rendered ${warm.rendered} samples; it should reuse all of them.`);
if (bench.largeAsset.peakTd2dMB > 500)
  problems.push(`The 512-sample asset peaked at ${bench.largeAsset.peakTd2dMB} MB, over 500 MB.`);
for (const p of problems) process.stderr.write(`${p}\n`);
process.stdout.write(problems.length === 0 ? `Benchmark meets its targets (cold ${cold?.seconds} s).\n` : '');
process.exit(problems.length === 0 ? 0 : 1);
