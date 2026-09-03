import React from 'react';

import {Text as RNText, type TextProps as RNTextProps, type TextStyle} from 'react-native';

import {useTheme} from '@core/theme/ThemeProvider';
import type {TypographyVariant} from '@core/theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: keyof ReturnType<typeof useTheme>['colors'];
  align?: TextStyle['textAlign'];
}

/**
 * The only text primitive in the app.
 *
 * Wrapping `RNText` rather than using it directly buys three things that are
 * hard to retrofit:
 *
 *  - every size and weight comes from the type scale, so "make the heading
 *    bigger" is a token change rather than a hunt through screens;
 *  - `allowFontScaling` stays on everywhere, which is how NFR-10's 200% font
 *    scaling requirement survives contact with a deadline;
 *  - a single place to attach font families when the brand face lands.
 *
 * Note there is no `maxFontSizeMultiplier` default. Capping scaling is the
 * usual reflex when a layout breaks at 200%, and it is the wrong fix — the
 * layout should flex.
 */
export function Text({
  variant = 'body',
  color = 'textPrimary',
  align,
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const theme = useTheme();
  const token = theme.typography[variant];

  return (
    <RNText
      allowFontScaling
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          fontWeight: token.fontWeight,
          // Kickers and metric labels carry their tracking and casing in the
          // token, so "uppercase, letter-spaced" is one variant name at the call
          // site rather than three properties a screen can get subtly wrong.
          letterSpacing: token.letterSpacing,
          textTransform: token.textTransform,
          color: theme.colors[color],
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
}
