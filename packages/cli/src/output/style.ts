import { styleText } from 'node:util';

type Format = Parameters<typeof styleText>[0];

/** Colour text for a stream. styleText drops colour for non-TTY streams and honours NO_COLOR and FORCE_COLOR. */
export function paint(format: Format, text: string, stream: NodeJS.WriteStream = process.stderr): string {
  return styleText(format, text, { stream });
}
