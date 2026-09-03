import React from 'react';

import {Image, useWindowDimensions, View} from 'react-native';

import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';

import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

/** The design bleeds the photograph across the top 54% of the screen. */
const HERO_FRACTION = 0.54;

/**
 * The photograph behind the first onboarding screen.
 *
 * Two things sit between the image and the copy, and both are load-bearing:
 *
 *  - the image is held at 55% opacity over the app ground. The design does this
 *    with `mix-blend-mode: lighten`, which React Native has no equivalent for;
 *    on a dark photograph over a dark ground the two land in the same place —
 *    the image reads as part of the surface rather than pasted onto it;
 *  - a gradient from transparent to the ground colour, so the bottom of the
 *    photograph dissolves instead of ending on a line. That is what lets the
 *    headline sit over the image at full contrast (NFR-10) without a plate.
 *
 * `react-native-svg` draws the gradient because the app has no gradient
 * dependency and this is the only place in the redesign that needs one — a
 * whole native module for one rectangle is not a trade worth making.
 */
export function OnboardingHero(): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  const {height} = useWindowDimensions();
  const heroHeight = Math.round(height * HERO_FRACTION);

  return (
    <View
      style={[styles.wrap, {height: heroHeight}]}
      pointerEvents="none"
      // Decorative. The headline beside it carries the meaning, and describing a
      // photograph of a street adds nothing a player can act on.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Image
        source={require('../assets/hero.jpg')}
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        style={styles.image}
      />
      {/*
        An explicit pixel height rather than "100%": the scrim is absolutely
        positioned, and a percentage on an SVG viewport whose parent height is
        itself computed resolves to 0 on some Android builds — which loses the
        fade and leaves the photograph ending on a hard line.
      */}
      <Svg width="100%" height={heroHeight} style={styles.scrim}>
        <Defs>
          <LinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.28" stopColor={theme.colors.background} stopOpacity={0} />
            <Stop offset="1" stopColor={theme.colors.background} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#heroScrim)" />
      </Svg>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: {
    ...({position: 'absolute', top: 0, left: 0, right: 0} as const),
    overflow: 'hidden',
  },
  image: {
    ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
    width: '100%',
    height: '100%',
    opacity: 0.55,
  },
  scrim: {
    ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
  },
}));
