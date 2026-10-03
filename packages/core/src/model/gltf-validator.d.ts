declare module 'gltf-validator' {
  export interface ValidatorMessage {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
  }
  export interface ValidatorReport {
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: ValidatorMessage[];
      truncated: boolean;
    };
  }
  export function version(): string;
  export function validateBytes(
    data: Uint8Array,
    options?: { maxIssues?: number; ignoredIssues?: string[]; uri?: string },
  ): Promise<ValidatorReport>;
}
