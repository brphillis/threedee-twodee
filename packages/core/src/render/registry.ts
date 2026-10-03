import { Td2dError } from '../errors.ts';
import type { BackendDescriptor } from './backend.ts';
import { headlessGlBackend } from './headless-gl.ts';
import { playwrightBackend } from './playwright.ts';

const BACKENDS: ReadonlyMap<string, BackendDescriptor> = new Map([
  [playwrightBackend.id, playwrightBackend],
  [headlessGlBackend.id, headlessGlBackend],
]);

export const DEFAULT_BACKEND_ID: string = playwrightBackend.id;

export function listBackends(): BackendDescriptor[] {
  return [...BACKENDS.values()];
}

export function getBackend(id: string): BackendDescriptor {
  const backend = BACKENDS.get(id);
  if (!backend) {
    throw new Td2dError('E_BACKEND_UNAVAILABLE', `Unknown render backend "${id}".`, {
      hint: `Available backends: ${[...BACKENDS.keys()].join(', ')}.`,
    });
  }
  return backend;
}
