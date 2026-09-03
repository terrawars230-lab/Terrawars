import React, {createContext, useContext, type PropsWithChildren} from 'react';

import {StyleSheet, type ImageStyle, type TextStyle, type ViewStyle} from 'react-native';

import {
  durations,
  layout,
  nocturneColors,
  radius,
  shadows,
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
  shadows: typeof shadows;
  isDark: boolean;
}

/**
 * The one theme.
 *
 * Nocturne is a dark-only system and the app is drawn in it: the settings
 * screen shows "Dark surface" as a switch that is on and disabled, which is the
 * design stating the same thing. Following `useColorScheme()` here would give a
 * user in light mode the chrome of one design and the map tiles of another.
 *
 * Built once at module scope rather than in a `useMemo`, because there is
 * nothing left for it to depend on. When a light variant is actually designed,
 * this is the one place a resolver and a stored preference plug back in.
 */
const nocturne: Theme = {
  colors: nocturneColors,
  spacing,
  radius,
  typography,
  layout,
  durations,
  shadows,
  isDark: true,
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({children}: PropsWithChildren): React.JSX.Element {
  return <ThemeContext.Provider value={nocturne}>{children}</ThemeContext.Provider>;
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
