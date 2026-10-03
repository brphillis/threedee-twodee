// Serves the engine example pages, the engines' browser builds and one asset's sheets folder:
//   node examples/engines/serve.ts examples/characters/build/characters/knight/sheets [port]
// then open http://localhost:<port>/phaser.html?clip=walk_s or /pixi.html?clip=walk_s.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const here = import.meta.dirname;
const require = createRequire(import.meta.url);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

/** The directory of an installed package, found by walking up from its entry point. */
function packageRoot(name: string): string {
  let dir = dirname(require.resolve(name));
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name)
      return dir;
    dir = dirname(dir);
  }
  throw new Error(`Cannot find the ${name} package. Run pnpm install.`);
}

/** Resolve a request path under a root, refusing anything that escapes it. */
function inside(root: string, path: string): string | null {
  const file = normalize(join(root, path));
  return file === root || file.startsWith(root + sep) ? file : null;
}

export function startEngineServer(sheetsDir: string, port = 0): Promise<{ server: Server; url: string }> {
  const sheets = resolve(sheetsDir);
  const vendor: Record<string, string> = {
    '/vendor/phaser.min.js': join(packageRoot('phaser'), 'dist', 'phaser.min.js'),
    '/vendor/pixi.min.js': join(packageRoot('pixi.js'), 'dist', 'pixi.min.js'),
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file =
      vendor[path] ??
      (path.startsWith('/sheets/')
        ? inside(sheets, path.slice('/sheets/'.length))
        : inside(here, path === '/' ? 'index.html' : path.slice(1)));
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      done({ server, url: `http://127.0.0.1:${actual}` });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [dir, port] = process.argv.slice(2);
  if (!dir) {
    process.stderr.write('Usage: node examples/engines/serve.ts <sheets directory> [port]\n');
    process.exit(2);
  }
  const { url } = await startEngineServer(dir, Number(port ?? 8080));
  process.stdout.write(`Serving ${resolve(dir)} at ${url}/phaser.html?clip=walk_s and ${url}/pixi.html?clip=walk_s\n`);
}
