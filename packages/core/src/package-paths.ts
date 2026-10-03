import { fileURLToPath } from 'node:url';

// This file sits directly under src/ and its compiled copy directly under dist/,
// so "../" is the package root in both cases.
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export const PACKAGE_ROOT: string = packageRoot;
export const BUILTIN_PRESETS_DIR: string = fileURLToPath(new URL('../presets/', import.meta.url));
export const BUILTIN_PALETTES_DIR: string = fileURLToPath(new URL('../palettes/', import.meta.url));
export const TEMPLATES_DIR: string = fileURLToPath(new URL('../templates/', import.meta.url));
