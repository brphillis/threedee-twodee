import type { WarningT } from '@td2d/schema';
import type { RenderedFrame } from './backend.ts';
import { opaqueBounds } from './frames.ts';

/** Edges of the frame that opaque pixels touch. */
export function touchedEdges(
  frame: Pick<RenderedFrame, 'width' | 'height' | 'rgba'>,
): ('top' | 'bottom' | 'left' | 'right')[] {
  const b = opaqueBounds(frame);
  if (!b) return [];
  const edges: ('top' | 'bottom' | 'left' | 'right')[] = [];
  if (b.y === 0) edges.push('top');
  if (b.y + b.h === frame.height) edges.push('bottom');
  if (b.x === 0) edges.push('left');
  if (b.x + b.w === frame.width) edges.push('right');
  return edges;
}

/** Quick per-frame checks that catch a mis-framed model while rendering. */
export function frameWarnings(frame: RenderedFrame, assetId?: string): WarningT[] {
  const id = assetId === undefined ? {} : { assetId };
  if (!opaqueBounds(frame)) {
    return [
      {
        code: 'W_BLANK_FRAME',
        message: `Frame ${frame.key} is empty.`,
        hint: 'Check the model position, pixelsPerUnit and camera.',
        ...id,
      },
    ];
  }
  const edges = touchedEdges(frame);
  if (edges.length > 0) {
    return [
      {
        code: 'W_FRAME_CLIPPED',
        message: `Frame ${frame.key} touches the ${edges.join(', ')} edge${edges.length > 1 ? 's' : ''}.`,
        hint: edges.includes('bottom')
          ? 'Increase camera.groundMargin or lower pixelsPerUnit.'
          : 'Increase the frame size or lower pixelsPerUnit.',
        ...id,
      },
    ];
  }
  return [];
}
