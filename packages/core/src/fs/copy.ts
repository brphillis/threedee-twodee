import { constants, copyFileSync } from 'node:fs';

/**
 * Copy a file, as a copy-on-write clone where the file system supports it (APFS, Btrfs,
 * XFS) and as an ordinary copy everywhere else. A clone shares the source's blocks until
 * either side is written, so copying a cached render into a build directory costs a
 * metadata update instead of a full read and write. The two files stay independent.
 */
export function cloneFile(source: string, target: string): void {
  copyFileSync(source, target, constants.COPYFILE_FICLONE);
}
