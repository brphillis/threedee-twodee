import type { ProgressReporter } from '@td2d/core';
import { paint } from './style.ts';

/** NDJSON progress events on stderr, one object per line. */
export function ndjsonProgress(write: (line: string) => void = (l) => process.stderr.write(l)): ProgressReporter {
  const emit = (event: Record<string, unknown>) =>
    write(`${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
  return {
    stageStart: (stage, info) => emit({ event: 'stage:start', stage, ...info }),
    itemDone: (stage, info) => emit({ event: 'item:done', stage, ...info }),
    stageDone: (stage, info) => emit({ event: 'stage:done', stage, ...info }),
  };
}

/** Human progress: a rewritten status line on a TTY, nothing otherwise (the command prints a summary). */
export function terminalProgress(stream: NodeJS.WriteStream = process.stderr): ProgressReporter {
  if (!stream.isTTY) return { stageStart() {}, itemDone() {}, stageDone() {} };
  const clear = () => stream.write('\r\x1b[2K');
  return {
    stageStart: (stage, info) => {
      clear();
      stream.write(paint('gray', `${stage}${info?.assetId ? ` ${info.assetId}` : ''}...`, stream));
    },
    itemDone: (stage, info) => {
      clear();
      stream.write(paint('gray', `${stage} ${info.n}/${info.total} ${info.key}`, stream));
    },
    stageDone: () => clear(),
  };
}
