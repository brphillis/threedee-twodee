import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { relativePosix, Td2dError } from '@td2d/core';
import { StaticSiteError, startViewer, writeStaticSite } from '@td2d/viewer';
import { type Command, Option } from 'commander';
import { integer } from '../options.ts';
import { action } from '../run.ts';

function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

export function registerViewer(program: Command): void {
  program
    .command('viewer')
    .description("Serve the read-only web viewer for this project's build directory until interrupted.")
    .option('--port <n>', 'Port to listen on (0 picks a free one)', integer(0, 65535), 4747)
    .option('--host <host>', 'Interface to bind', '127.0.0.1')
    .option('--open', 'Open the viewer in the default browser')
    .option('--no-watch', 'Do not watch build/ for changes: no live reload')
    .addOption(
      new Option(
        '--watch-mode <mode>',
        'native uses fs.watch; poll checks every 200 ms, for mounts that deliver no file events (some Docker and network file systems)',
      )
        .choices(['native', 'poll'])
        .default('native'),
    )
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d viewer --open\n  $ td2d viewer --port 0 --json\n  $ td2d viewer --watch-mode poll\n\nThe URL is logged on stderr as soon as the server listens (an NDJSON line with "url" under --json). Stop with Ctrl+C.\n',
    )
    .action(
      action(
        async (
          ctx,
          opts: { port: number; host: string; open?: boolean; watch: boolean; watchMode: 'native' | 'poll' },
        ) => {
          const project = ctx.project();
          let viewer: Awaited<ReturnType<typeof startViewer>>;
          try {
            viewer = await startViewer({
              buildDir: project.paths.build,
              historyDir: project.paths.history,
              projectName: project.config.name,
              port: opts.port,
              host: opts.host,
              watch: opts.watch ? opts.watchMode : 'off',
            });
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EADDRINUSE' || code === 'EACCES' || code === 'EADDRNOTAVAIL')
              throw new Td2dError(
                'E_USAGE',
                `Cannot listen on ${opts.host}:${opts.port}: ${(error as Error).message}.`,
                {
                  hint:
                    code === 'EADDRINUSE'
                      ? 'Another program uses that port. Pass --port 0 to pick a free one, or another port.'
                      : 'Choose another --host or --port.',
                },
              );
            throw error;
          }
          ctx.logger.info(`Viewer running at ${viewer.url}`, {
            url: viewer.url,
            buildDir: project.paths.build,
            watch: viewer.watch,
          });
          if (opts.open) openInBrowser(viewer.url);
          await new Promise<void>((done) => {
            if (ctx.signal.aborted) done();
            ctx.signal.addEventListener('abort', () => done(), { once: true });
          });
          await viewer.close();
          const data = { url: viewer.url, watch: viewer.watch, stopped: true };
          return { data, human: () => 'Viewer stopped.' };
        },
      ),
    );

  program
    .command('index')
    .description(
      'Write the viewer as a static site into build/ (index.html, index.json and _td2d/) so any static file server can show the build without td2d.',
    )
    .option('--out <dir>', 'Write the site here instead, copying the build outputs it needs')
    .option('--no-history', 'Leave out history entries (the History and Compare tabs are then empty)')
    .addHelpText(
      'after',
      '\nExamples:\n  $ td2d index --json\n  $ npx serve build\n  $ td2d index --out /tmp/site --no-history\n',
    )
    .action(
      action(async (ctx, opts: { out?: string; history: boolean }) => {
        const project = ctx.project();
        let site: ReturnType<typeof writeStaticSite>;
        try {
          site = writeStaticSite({
            buildDir: project.paths.build,
            historyDir: project.paths.history,
            projectName: project.config.name,
            history: opts.history,
            ...(opts.out ? { outDir: resolve(ctx.cwd, opts.out) } : {}),
          });
        } catch (error) {
          if (error instanceof StaticSiteError)
            throw new Td2dError(error.reason === 'no-client' ? 'E_INTERNAL' : 'E_USAGE', error.message, {
              hint:
                error.reason === 'not-ours'
                  ? 'Choose another directory with --out, or move that index.html away.'
                  : 'Build the viewer client first.',
            });
          throw error;
        }
        const data = {
          outDir: relativePosix(ctx.cwd, site.outDir) || '.',
          index: relativePosix(ctx.cwd, resolve(site.outDir, 'index.json')),
          assets: site.assets,
          historyEntries: site.historyEntries,
        };
        return {
          data,
          human: (d: typeof data) =>
            `Wrote the static viewer to ${d.outDir} with ${d.assets} asset(s) and ${d.historyEntries} history entr${d.historyEntries === 1 ? 'y' : 'ies'}. Serve it with any static file server.`,
        };
      }),
    );
}
