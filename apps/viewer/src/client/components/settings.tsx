import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useStored } from './hooks.ts';
import { BACKGROUNDS, type Background } from './PixelCanvas.tsx';

export interface ViewSettings {
  readonly background: Background;
  readonly showCells: boolean;
  readonly pixelGrid: boolean;
  setBackground(b: Background): void;
  nextBackground(): void;
  toggleCells(): void;
  togglePixelGrid(): void;
}

const isBackground = (v: unknown): v is Background => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    (b.kind === 'checker' && typeof b.size === 'number' && b.size > 0 && b.size <= 64) ||
    (b.kind === 'solid' && typeof b.colour === 'string' && /^#[0-9a-f]{6}$/i.test(b.colour))
  );
};
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

const Context = createContext<ViewSettings | null>(null);

/** Canvas settings shared by every tab and kept between visits. */
export function ViewSettingsProvider({ children }: { children: ReactNode }) {
  const [background, setBackground] = useStored<Background>('background', BACKGROUNDS[0] as Background, isBackground);
  const [showCells, setShowCells] = useStored('cells', true, isBoolean);
  const [pixelGrid, setPixelGrid] = useStored('pixel-grid', true, isBoolean);
  const value = useMemo<ViewSettings>(
    () => ({
      background,
      showCells,
      pixelGrid,
      setBackground,
      nextBackground: () =>
        setBackground((b) => {
          const i = BACKGROUNDS.findIndex((x) => JSON.stringify(x) === JSON.stringify(b));
          return BACKGROUNDS[(i + 1) % BACKGROUNDS.length] as Background;
        }),
      toggleCells: () => setShowCells((v) => !v),
      togglePixelGrid: () => setPixelGrid((v) => !v),
    }),
    [background, showCells, pixelGrid, setBackground, setShowCells, setPixelGrid],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useViewSettings(): ViewSettings {
  const value = useContext(Context);
  if (!value) throw new Error('useViewSettings needs a ViewSettingsProvider');
  return value;
}
