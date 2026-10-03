// Q11: is fs.watch({ recursive: true }) reliable on Linux and in Docker? Runs the viewer's watcher
// in the Playwright Linux image for container-local and bind-mounted directories, with writes
// from inside the container and from the host, natively and with polling.
//   pnpm build && node scripts/q11/run.ts
// Writes docs/roadmaps/assets/phase-9/q11.json.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const repo = join(import.meta.dirname, '..', '..');
const shared = realpathSync(mkdtempSync(join(tmpdir(), 'td2d-q11-')));
const image = 'mcr.microsoft.com/playwright:v1.63.0-noble';
const results: Record<string, unknown>[] = [];
try {
  for (const arch of ['arm64', 'amd64']) {
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        `linux/${arch}`,
        '-v',
        `${repo}:/src:ro`,
        '-v',
        `${shared}:/shared`,
        image,
        'node',
        '/src/scripts/q11/container.mjs',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    for await (const line of createInterface({ input: child.stdout })) {
      if (line.startsWith('READY ')) {
        // The host writes into the bind mount, as an editor or a host-side td2d run would.
        writeFileSync(join(shared, 'build', 'props', 'crate', 'sheets', 'manifest.json'), String(Date.now()));
        continue;
      }
      if (line.startsWith('{')) results.push({ arch, ...JSON.parse(line) });
    }
  }
} finally {
  rmSync(shared, { recursive: true, force: true });
}
const docker = await new Promise<string>((resolve) => {
  let out = '';
  const c = spawn('docker', ['info', '--format', '{{.OperatingSystem}} {{.ServerVersion}}'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  c.stdout.on('data', (d: Buffer) => (out += d));
  c.on('exit', () => resolve(out.trim()));
});
const out = join(repo, 'docs', 'roadmaps', 'assets', 'phase-9');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'q11.json'),
  `${JSON.stringify({ host: `${process.platform}-${process.arch}`, docker, image, results }, null, 2)}\n`,
);
for (const r of results) process.stdout.write(`${JSON.stringify(r)}\n`);
