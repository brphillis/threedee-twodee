import { isTd2dError, type Logger, openProject, type ProgressReporter, type Project } from '@td2d/core';

export interface GlobalOptions {
  readonly project?: string;
  readonly json?: boolean;
  readonly logLevel?: string;
  readonly color?: boolean;
}

export interface CommandContext {
  readonly cwd: string;
  readonly json: boolean;
  readonly globals: GlobalOptions;
  readonly logger: Logger;
  readonly progress: ProgressReporter;
  readonly signal: AbortSignal;
  /** Open the project or throw E_PROJECT_NOT_FOUND / E_PROJECT_INVALID. */
  project(): Project;
  /** The project, the error from opening it, or undefined when there is no project. */
  tryProject(): Project | Error | undefined;
}

export function createProjectAccessors(cwd: string, explicitRoot: string | undefined) {
  let cached: Project | undefined;
  const project = (): Project => {
    cached ??= openProject({ cwd, explicitRoot });
    return cached;
  };
  const tryProject = (): Project | Error | undefined => {
    try {
      return project();
    } catch (error) {
      if (isTd2dError(error) && error.code === 'E_PROJECT_NOT_FOUND' && explicitRoot === undefined) return undefined;
      return error as Error;
    }
  };
  return { project, tryProject };
}
