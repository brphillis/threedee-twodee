import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Td2dError } from '../errors.ts';

export const OUTPUT_MARKER = '.td2d-output';

/**
 * Make `dir` safe to write generated files into. It must not exist, be empty, or already
 * carry the marker td2d writes, so td2d never mixes its output with someone else's files.
 */
export function prepareOutputDir(dir: string): { created: boolean } {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, OUTPUT_MARKER), `${JSON.stringify({ tool: 'td2d' })}\n`);
    return { created: true };
  }
  if (!statSync(dir).isDirectory()) {
    throw new Td2dError('E_OUTPUT_DIR_NOT_EMPTY', `${dir} exists and is not a directory.`, { details: { dir } });
  }
  const entries = readdirSync(dir);
  if (entries.includes(OUTPUT_MARKER)) return { created: false };
  if (entries.length > 0) {
    throw new Td2dError('E_OUTPUT_DIR_NOT_EMPTY', `${dir} contains files td2d did not write.`, {
      details: { dir, entries: entries.slice(0, 20) },
    });
  }
  writeFileSync(join(dir, OUTPUT_MARKER), `${JSON.stringify({ tool: 'td2d' })}\n`);
  return { created: false };
}
