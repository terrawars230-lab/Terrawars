import {useEffect, useState} from 'react';

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 *
 * Used wherever a fast-changing value drives a network call — the username
 * availability check (FR-02) and the map viewport query (FR-51). Both would
 * otherwise fire once per keystroke or per frame of pan.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
