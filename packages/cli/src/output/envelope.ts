import type { Td2dError } from '@td2d/core';
import type { CliEnvelopeT, ErrorDetailT, WarningT } from '@td2d/schema';
import { paint } from './style.ts';

export function buildEnvelope(input: {
  command: string;
  version: string;
  durationMs: number;
  data?: unknown;
  warnings: readonly WarningT[];
  error?: Td2dError;
}): CliEnvelopeT {
  return {
    ok: input.error === undefined,
    command: input.command,
    version: input.version,
    durationMs: input.durationMs,
    ...(input.data === undefined ? {} : { data: input.data }),
    warnings: [...input.warnings],
    ...(input.error ? { error: input.error.toDetail() } : {}),
  };
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function location(file: string | undefined, path: string | undefined): string {
  if (file && path) return `${file} ${path}`;
  return file ?? path ?? '';
}

/** Human-readable error for stderr. */
export function formatError(detail: ErrorDetailT): string {
  const lines = [`${paint(['bold', 'red'], 'error')} ${paint('red', `[${detail.code}]`)} ${detail.message}`];
  const issues = detail.issues ?? [];
  const shown = issues.slice(0, 50);
  for (const issue of shown) {
    const where = location(issue.file, issue.path || '(document)');
    lines.push(`  ${paint('cyan', where)}: ${issue.message}`);
  }
  if (issues.length > shown.length) lines.push(`  ...and ${issues.length - shown.length} more`);
  const conflicts = detail.details?.conflicts;
  if (Array.isArray(conflicts)) for (const c of conflicts) lines.push(`  ${paint('cyan', String(c))}: already exists`);
  if (detail.hint) lines.push(`${paint('yellow', 'hint')} ${detail.hint}`);
  return `${lines.join('\n')}\n`;
}

export function formatWarning(w: WarningT): string {
  const where = location(w.file, w.path);
  return `${paint('yellow', 'warning')} ${paint('yellow', `[${w.code}]`)} ${w.message}${where ? ` ${paint('gray', `(${where})`)}` : ''}\n`;
}
