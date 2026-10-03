import { createContext, useContext } from 'react';
import type { DataSource } from '../data.ts';

export const SourceContext = createContext<DataSource | null>(null);

export function useSource(): DataSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error('useSource needs a SourceContext provider');
  return source;
}
