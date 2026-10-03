#!/usr/bin/env node
import { main } from './program.ts';

main().catch((error: unknown) => {
  process.stderr.write(
    `td2d: unexpected failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
