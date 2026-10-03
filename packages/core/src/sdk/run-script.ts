// Runs one asset script in a child process and prints its definition as JSON on stdout.
// td2d starts this with Node's permission model: the script may read files but not write them
// or start processes.
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Node 24's permission model has no network permission, so the network APIs are replaced before
 * the script loads: each throws ERR_ACCESS_DENIED. syncBuiltinESMExports makes `import { connect }
 * from 'node:net'` see the replacement too. This stops mistakes, not a determined attacker.
 */
function blockNetwork(): void {
  const denied = (what: string) => () => {
    const error = new Error(`Asset scripts may not use the network (${what}).`) as Error & Record<string, string>;
    error.code = 'ERR_ACCESS_DENIED';
    error.permission = 'Network';
    error.resource = what;
    throw error;
  };
  const require = createRequire(import.meta.url);
  const replace = (module: string, names: string[]) => {
    const target = require(module) as Record<string, unknown>;
    for (const name of names) if (name in target) target[name] = denied(`${module}.${name}`);
  };
  replace('node:net', ['connect', 'createConnection', 'createServer']);
  replace('node:tls', ['connect', 'createServer']);
  replace('node:http', ['request', 'get', 'createServer']);
  replace('node:https', ['request', 'get', 'createServer']);
  replace('node:http2', ['connect', 'createServer', 'createSecureServer']);
  replace('node:dgram', ['createSocket']);
  replace('node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']);
  const net = require('node:net') as { Socket: { prototype: Record<string, unknown> } };
  net.Socket.prototype.connect = denied('net.Socket.connect');
  syncBuiltinESMExports();
  for (const name of ['fetch', 'WebSocket', 'EventSource'] as const)
    if (name in globalThis)
      Object.defineProperty(globalThis, name, { value: denied(name), configurable: false, writable: false });
}

/**
 * Scripts import `@td2d/core/sdk`. A project that installs td2d itself resolves its own copy;
 * when it cannot (td2d installed globally with `npm install -g`, or run with npx), the import
 * falls back to the copy of td2d that is running. The hooks run in this thread, since the
 * permission model allows no worker threads, and the fallback reads only files the read
 * allowlist already covers.
 */
function resolveTd2dFromHere(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          (error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND' ||
          !/^@td2d\/(core|schema)(\/|$)/.test(specifier)
        )
          throw error;
        return { url: import.meta.resolve(specifier), shortCircuit: true };
      }
    },
  });
}

blockNetwork();
resolveTd2dFromHere();

const script = process.argv[2];
if (!script) {
  process.stderr.write('usage: run-script <script>\n');
  process.exit(2);
}
try {
  const mod = (await import(pathToFileURL(resolve(script)).href)) as { default?: unknown };
  const value = typeof mod.default === 'function' ? await (mod.default as () => unknown)() : mod.default;
  if (value === undefined)
    throw new Error('The script has no default export. Export an asset definition, or a function that returns one.');
  process.stdout.write(JSON.stringify(value));
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code === 'ERR_ACCESS_DENIED') {
    // One line td2d parses to say what was refused.
    const { permission, resource } = error as { permission?: string; resource?: string };
    process.stderr.write(
      `TD2D_ACCESS_DENIED ${JSON.stringify({ permission: permission ?? null, resource: resource ?? null })}\n`,
    );
  }
  process.stderr.write(
    `${code ? `[${code}] ` : ''}${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
}
