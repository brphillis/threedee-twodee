import { ERROR_CATALOG, type ErrorCode, type ErrorDetailT, errorAnchor, exitCodeFor, type IssueT } from '@td2d/schema';

export interface Td2dErrorOptions {
  readonly file?: string;
  readonly issues?: readonly IssueT[];
  readonly hint?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

/** An error with a stable code, an exit code and agent-readable details. */
export class Td2dError extends Error {
  readonly code: ErrorCode;
  readonly file: string | undefined;
  readonly issues: readonly IssueT[] | undefined;
  readonly hint: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: Td2dErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'Td2dError';
    this.code = code;
    this.file = options.file;
    this.issues = options.issues;
    this.hint = options.hint ?? ERROR_CATALOG[code].hint;
    this.details = options.details;
  }

  get exitCode(): number {
    return exitCodeFor(this.code);
  }

  toDetail(): ErrorDetailT {
    return {
      code: this.code,
      message: this.message,
      ...(this.file === undefined ? {} : { file: this.file }),
      ...(this.issues === undefined ? {} : { issues: [...this.issues] }),
      hint: this.hint,
      docs: errorDocsPath(this.code),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function errorDocsPath(code: ErrorCode): string {
  return `docs/reference/errors.md#${errorAnchor(code)}`;
}

export function isTd2dError(value: unknown): value is Td2dError {
  return value instanceof Td2dError;
}

/** Convert anything thrown into a Td2dError, keeping the original as the cause. */
export function toTd2dError(value: unknown): Td2dError {
  if (value instanceof Td2dError) return value;
  if (value instanceof Error && value.name === 'AbortError') {
    return new Td2dError('E_CANCELLED', 'The operation was cancelled.', { cause: value });
  }
  const message = value instanceof Error ? value.message : String(value);
  return new Td2dError('E_INTERNAL', message, { cause: value });
}
