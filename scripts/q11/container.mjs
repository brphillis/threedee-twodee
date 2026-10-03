// Runs inside the Linux container: for each scenario, watch a build directory with the viewer's
// watcher and report whether, and how fast, a write is noticed. Host-side writes are requested
// by printing READY and waiting; the host script performs them.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchBuild } from '/src/apps/viewer/dist/server/watch.js';

const scenarios = [
  { name: 'container-dir native', dir: '/tmp/q11/build', mode: 'native', writer: 'container' },
  { name: 'container-dir poll', dir: '/tmp/q11/build', mode: 'poll', writer: 'container' },
  { name: 'bind-mount native, container writes', dir: '/shared/build', mode: 'native', writer: 'container' },
  { name: 'bind-mount poll, container writes', dir: '/shared/build', mode: 'poll', writer: 'container' },
  { name: 'container-dir native, new asset directory', dir: '/tmp/q11/build', mode: 'native', writer: 'container-new' },
  { name: 'container-dir poll, new asset directory', dir: '/tmp/q11/build', mode: 'poll', writer: 'container-new' },
  {
    name: 'container-dir native, file in a directory made after the watch',
    dir: '/tmp/q11/build',
    mode: 'native',
    writer: 'container-late',
  },
  { name: 'bind-mount native, host writes', dir: '/shared/build', mode: 'native', writer: 'host' },
  { name: 'bind-mount poll, host writes', dir: '/shared/build', mode: 'poll', writer: 'host' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const s of scenarios) {
  rmSync(s.dir, { recursive: true, force: true });
  mkdirSync(join(s.dir, 'props', 'crate', 'sheets'), { recursive: true });
  writeFileSync(join(s.dir, 'props', 'crate', '.td2d-output'), '');
  let seen = null;
  let started = 0;
  const watcher = await watchBuild(
    s.dir,
    s.mode,
    (assets) => {
      if (started && !seen) seen = { assets, ms: Math.round(performance.now() - started) };
    },
    100,
  );
  await wait(600);
  started = performance.now();
  if (s.writer === 'container')
    writeFileSync(join(s.dir, 'props', 'crate', 'sheets', 'manifest.json'), String(Date.now()));
  else if (s.writer === 'container-new') {
    // A first generation of a new asset: its directories do not exist yet.
    mkdirSync(join(s.dir, 'props', 'barrel', 'sheets'), { recursive: true });
    writeFileSync(join(s.dir, 'props', 'barrel', 'sheets', 'manifest.json'), '{}');
  } else if (s.writer === 'container-late') {
    // A directory made after the watch began, then, a moment later, a file written inside it:
    // only seen if the watcher picked up the new directory.
    mkdirSync(join(s.dir, 'props', 'crate', 'renders'));
    await wait(300);
    started = performance.now();
    seen = null;
    writeFileSync(join(s.dir, 'props', 'crate', 'renders', 'late.png'), 'x');
  } else process.stdout.write(`READY ${s.name}\n`);
  const deadline = performance.now() + 4000;
  while (!seen && performance.now() < deadline) await wait(20);
  await watcher.close();
  process.stdout.write(
    `${JSON.stringify({ scenario: s.name, mode: s.mode, writer: s.writer, noticed: Boolean(seen), latencyMs: seen?.ms ?? null, assets: seen?.assets ?? null })}\n`,
  );
}
process.exit(0);
