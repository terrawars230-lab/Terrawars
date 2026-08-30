import React, {type PropsWithChildren} from 'react';

import {
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SafeAreaView, type Edge} from 'react-native-safe-area-context';

import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

export interface ScreenProps extends PropsWithChildren {
  /** Wraps children in a ScrollView. Never use on a screen containing the map. */
  scrollable?: boolean;
  /**
   * Which safe-area edges to inset. The map screen passes `[]` so the map can
   * bleed under the status bar while its controls inset themselves.
   */
  edges?: readonly Edge[];
  /** Removes the default horizontal padding, for full-bleed content. */
  bleed?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Screen container: safe-area insets, background, status-bar style and the
 * standard horizontal padding, in one place.
 *
 * Every screen uses this. The alternative — each screen assembling its own
 * SafeAreaView and padding — is how an app ends up with six different left
 * margins and a status bar that is the wrong colour on one tab.
 */
export function Screen({
  children,
  scrollable = false,
  edges = ['top', 'bottom'],
  bleed = false,
  style,
  contentContainerStyle,
}: ScreenProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();

  const content = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, !bleed && styles.padded, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, !bleed && styles.padded, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.root, style]}>
      {/*
        No backgroundColor or translucent props: RN 0.87 ships edge-to-edge by
        default (see android/gradle.properties), which draws behind the system
        bars already and removed those props.
      */}
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      {content}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(theme => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flex: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: theme.layout.screenPaddingHorizontal,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xxl,
  },
}));

export const screenStyles = StyleSheet.create({
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
