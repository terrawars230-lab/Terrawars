import React, {createContext, useContext, useMemo, type PropsWithChildren} from 'react';

import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  darkColors,
  durations,
  layout,
  lightColors,
  radius,
  spacing,
  typography,
  type ThemeColors,
} from './tokens';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  layout: typeof layout;
  durations: typeof durations;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Provides the resolved theme.
 *
 * Follows the system colour scheme with no in-app override in v1. That is a
 * deliberate scope call rather than an omission: an app whose main surface is a
 * map has to theme the map tiles too, and shipping a toggle that changes the
 * chrome but not the map looks broken. When the tile style gets a dark variant,
 * this is the one place a stored preference plugs in.
 */
export function ThemeProvider({children}: PropsWithChildren): React.JSX.Element {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      layout,
      durations,
      isDark,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return theme;
}

/** The shape `StyleSheet.create` accepts: a flat map of named style objects. */
type NamedStyles<T> = {[P in keyof T]: ViewStyle | TextStyle | ImageStyle};

/**
 * Builds a memoised StyleSheet from the theme.
 *
 * Two things this does that an inline `style={{...}}` cannot:
 *
 *  - it runs the result through `StyleSheet.create`, which registers the styles
 *    once instead of allocating a fresh object on every render. With 500
 *    parcels on screen (NFR-03) that difference is measurable;
 *  - the `NamedStyles` constraint keeps string literals narrow, so
 *    `flexDirection: 'row'` stays `'row'` rather than widening to `string` and
 *    failing to typecheck against the RN style types.
 *
 * The cache is keyed on the theme object, so a light/dark switch rebuilds the
 * sheet exactly once rather than on every consuming component.
 *
 * @example
 * const useStyles = makeStyles(theme => ({
 *   card: {backgroundColor: theme.colors.surface, padding: theme.spacing.lg},
 * }));
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<never>>(
  factory: (theme: Theme) => T,
): () => T {
  const cache = new WeakMap<Theme, T>();

  return function useStyles(): T {
    const theme = useTheme();
    const cached = cache.get(theme);
    if (cached) {
      return cached;
    }
    const styles = StyleSheet.create(factory(theme));
    cache.set(theme, styles);
    return styles;
  };
}
