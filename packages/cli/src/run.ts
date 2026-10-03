import { Td2dError, toTd2dError } from '@td2d/core';
import type { WarningT } from '@td2d/schema';
import type { Command } from 'commander';
import { type CommandContext, createProjectAccessors, type GlobalOptions } from './context.ts';
import { buildEnvelope, formatError, formatWarning, writeJson } from './output/envelope.ts';
import { createPino, LOG_LEVELS, type LogLevel, toCoreLogger } from './output/logger.ts';
import { ndjsonProgress, terminalProgress } from './output/progress.ts';
import { CLI_VERSION } from './version.ts';

export interface CommandResult<T = unknown> {
  readonly data?: T;
  readonly warnings?: readonly WarningT[];
  /** A failure that still has data to report, such as a validation report. */
  readonly error?: Td2dError;
  /** Human output for stdout. Omit to print nothing. */
  human?(data: T): string;
}

export type Handler<A extends unknown[]> = (ctx: CommandContext, ...args: A) => Promise<CommandResult> | CommandResult;

/** "asset create" for a nested command, "validate" for a top-level one. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c?.parent; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

function resolveLogLevel(globals: GlobalOptions): LogLevel {
  const level = globals.logLevel ?? 'info';
  return (LOG_LEVELS as readonly string[]).includes(level) ? (level as LogLevel) : 'info';
}

/**
 * Wrap a command handler: build the context, run it, print one envelope (with --json)
 * or human output, and set the exit code. Handlers never print the envelope themselves.
 */
export function action<A extends unknown[]>(handler: Handler<A>) {
  return async function (this: Command, ...rawArgs: unknown[]): Promise<void> {
    const globals = this.optsWithGlobals() as GlobalOptions;
    const json = globals.json === true;
    const started = performance.now();
    const pinoLogger = createPino(resolveLogLevel(globals), json);
    const controller = new AbortController();
    let interrupts = 0;
    const onSignal = (signal: NodeJS.Signals) => {
      interrupts++;
      if (interrupts > 1) process.exit(130);
      pinoLogger.warn({ signal }, 'Cancelling. Press Ctrl+C again to exit immediately.');
      controller.abort(new Td2dError('E_CANCELLED', `Cancelled by ${signal}.`));
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const cwd = process.cwd();
    const accessors = createProjectAccessors(cwd, globals.project);
    const ctx: CommandContext = {
      cwd,
      json,
      globals,
      logger: toCoreLogger(pinoLogger),
      progress: json ? ndjsonProgress() : terminalProgress(),
      signal: controller.signal,
      ...accessors,
    };

    // Commander passes positional arguments, then the options object, then the command.
    const args = rawArgs.slice(0, -1) as A;
    let result: CommandResult = {};
    let error: Td2dError | undefined;
    try {
      result = await handler(ctx, ...args);
      error = result.error;
    } catch (thrown) {
      error = controller.signal.aborted
        ? new Td2dError('E_CANCELLED', 'The operation was cancelled.', { cause: thrown })
        : toTd2dError(thrown);
      if (error.code === 'E_INTERNAL') pinoLogger.debug({ stack: (thrown as Error)?.stack }, 'Internal error');
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }

    const warnings = result.warnings ?? [];
    if (json) {
      writeJson(
        buildEnvelope({
          command: commandPath(this),
          version: CLI_VERSION,
          durationMs: Math.round(performance.now() - started),
          data: result.data,
          warnings,
          ...(error ? { error } : {}),
        }),
      );
    } else {
      if (result.human && result.data !== undefined) {
        const text = result.human(result.data);
        if (text) process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      }
      for (const w of warnings) process.stderr.write(formatWarning(w));
      if (error) process.stderr.write(formatError(error.toDetail()));
    }
    process.exitCode = error ? error.exitCode : 0;
  };
}
