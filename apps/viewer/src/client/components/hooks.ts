import { useEffect, useRef, useState } from 'react';
import { isTyping, type Scope, shortcutFor } from '../lib/shortcuts.ts';

/**
 * Run `handlers[id]` when a shortcut of one of `scopes` is pressed outside a text field. The
 * handler gets the key, for shortcuts with several keys such as the tab numbers.
 */
export function useShortcuts(
  scopes: readonly Scope[],
  handlers: Partial<Record<string, (key: string) => void>>,
  enabled = true,
): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const scopeKey = scopes.join(',');
  useEffect(() => {
    if (!enabled) return;
    const active = scopeKey.split(',') as Scope[];
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTyping(event.target as HTMLElement | null)) return;
      const shortcut = shortcutFor(event.key, active);
      const handler = shortcut ? latest.current[shortcut.id] : undefined;
      if (!shortcut || !handler) return;
      event.preventDefault();
      handler(event.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scopeKey, enabled]);
}

/**
 * Resolve `make()` into state, again whenever `key` changes, ignoring results that arrive after
 * it changed. `key` names everything `make` depends on.
 */
export function useAsync<T>(
  key: string,
  make: () => Promise<T>,
): { value: T | null; error: string | null; loading: boolean } {
  // Each result carries the key it was made for, so a stale one is never shown for a new key.
  const [state, setState] = useState<{ key: string | null; value: T | null; error: string | null }>({
    key: null,
    value: null,
    error: null,
  });
  const latest = useRef(make);
  latest.current = make;
  useEffect(() => {
    let live = true;
    latest.current().then(
      (value) => live && setState({ key, value, error: null }),
      (error: unknown) =>
        live && setState({ key, value: null, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const current = state.key === key;
  return { value: current ? state.value : null, error: current ? state.error : null, loading: !current };
}

/** State kept in localStorage, falling back to memory when storage is unavailable. */
export function useStored<T>(
  key: string,
  initial: T,
  valid: (v: unknown) => v is T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`td2d:${key}`);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) return parsed;
      }
    } catch {
      // Private windows and blocked storage: keep the default.
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(`td2d:${key}`, JSON.stringify(value));
    } catch {
      // Not persisted; the setting still applies for this page.
    }
  }, [key, value]);
  return [value, setValue];
}
