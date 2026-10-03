import type { Logger } from '@td2d/core';
import pino, { type LevelWithSilent, type Logger as PinoLogger } from 'pino';
import { paint } from './style.ts';

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Writes pino records as short human lines on stderr. */
function humanDestination() {
  return {
    write(line: string) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        process.stderr.write(line);
        return;
      }
      const { level, msg, time: _t, pid: _p, hostname: _h, ...fields } = record;
      const name = typeof level === 'number' ? (LEVEL_NAMES[level] ?? String(level)) : String(level);
      const color = name === 'error' || name === 'fatal' ? 'red' : name === 'warn' ? 'yellow' : 'gray';
      const extra = Object.keys(fields).length > 0 ? ` ${paint('gray', JSON.stringify(fields))}` : '';
      process.stderr.write(`${paint(color, name)} ${String(msg ?? '')}${extra}\n`);
    },
  };
}

export function createPino(level: LogLevel, json: boolean): PinoLogger {
  const options = {
    level: level as LevelWithSilent,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(json ? { formatters: { level: (label: string) => ({ level: label }) } } : {}),
  };
  return json ? pino(options, pino.destination({ fd: 2, sync: true })) : pino(options, humanDestination());
}

/** Adapt pino to the core Logger interface. */
export function toCoreLogger(p: PinoLogger): Logger {
  return {
    debug: (message, fields) => p.debug(fields ?? {}, message),
    info: (message, fields) => p.info(fields ?? {}, message),
    warn: (message, fields) => p.warn(fields ?? {}, message),
    error: (message, fields) => p.error(fields ?? {}, message),
  };
}
