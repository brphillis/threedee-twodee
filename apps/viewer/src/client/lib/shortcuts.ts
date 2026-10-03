// Keyboard shortcuts, in one table so the help overlay always matches the handlers. No DOM.

export const SCOPES = ['global', 'canvas', 'animation', 'compare', 'library'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Shortcut {
  readonly id: string;
  /** Values of KeyboardEvent.key that trigger it. */
  readonly keys: readonly string[];
  readonly scope: Scope;
  readonly description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'help', keys: ['?'], scope: 'global', description: 'Show or hide this help' },
  { id: 'close', keys: ['Escape'], scope: 'global', description: 'Close help, or go back to the library' },
  { id: 'tab', keys: ['1', '2', '3', '4', '5', '6', '7'], scope: 'global', description: 'Switch asset tab' },
  { id: 'search', keys: ['/'], scope: 'library', description: 'Focus the search box' },
  { id: 'layout', keys: ['v'], scope: 'library', description: 'Switch between grid and list' },
  { id: 'zoom-in', keys: ['+', '='], scope: 'canvas', description: 'Zoom in' },
  { id: 'zoom-out', keys: ['-', '_'], scope: 'canvas', description: 'Zoom out' },
  { id: 'zoom-fit', keys: ['0'], scope: 'canvas', description: 'Fit to the window' },
  { id: 'cells', keys: ['c'], scope: 'canvas', description: 'Show or hide cell outlines' },
  { id: 'grid', keys: ['x'], scope: 'canvas', description: 'Show or hide the pixel grid (above 8x)' },
  { id: 'background', keys: ['b'], scope: 'canvas', description: 'Next background' },
  { id: 'play', keys: [' '], scope: 'animation', description: 'Play or pause' },
  { id: 'step-back', keys: [',', 'ArrowLeft'], scope: 'animation', description: 'Previous frame' },
  { id: 'step-forward', keys: ['.', 'ArrowRight'], scope: 'animation', description: 'Next frame' },
  { id: 'direction-prev', keys: ['['], scope: 'animation', description: 'Previous direction' },
  { id: 'direction-next', keys: [']'], scope: 'animation', description: 'Next direction' },
  { id: 'onion', keys: ['o'], scope: 'animation', description: 'Onion skin of the previous frame' },
  { id: 'all-directions', keys: ['d'], scope: 'animation', description: 'Play every direction at once' },
  { id: 'loop-mode', keys: ['l'], scope: 'animation', description: 'Next loop mode: loop, ping-pong, once' },
  { id: 'compare-mode', keys: ['m'], scope: 'compare', description: 'Next compare mode' },
  { id: 'blink', keys: ['k'], scope: 'compare', description: 'Swap the shown side in blink mode' },
];

/** The shortcut a key press triggers within the active scopes, if any. */
export function shortcutFor(key: string, scopes: readonly Scope[]): Shortcut | undefined {
  return SHORTCUTS.find((s) => scopes.includes(s.scope) && s.keys.includes(key));
}

const TEXT_INPUTS = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel', '']);

/** Whether a key event came from a text field, where shortcuts must not fire. */
export function isTyping(target: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'INPUT') return TEXT_INPUTS.has((target.type ?? '').toLowerCase());
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** How a key looks in the help overlay. */
export function keyLabel(key: string): string {
  return key === ' ' ? 'Space' : key === 'ArrowLeft' ? '←' : key === 'ArrowRight' ? '→' : key;
}
