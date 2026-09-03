import React, {type PropsWithChildren} from 'react';

import {View, type StyleProp, type ViewStyle} from 'react-native';

import {makeStyles} from '@core/theme/ThemeProvider';

import {Text} from './Text';

export type TagVariant = 'outline' | 'accent' | 'neutral';

export interface TagProps extends PropsWithChildren {
  label: string;
  variant?: TagVariant;
  /** Rendered before the label — a shield on "Protected", say. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A small status pill: "Raid", "Protected".
 *
 * Deliberately not pressable. Every tag in the design sits inside something
 * that is already tappable (a raid card, a parcel row), and making the tag its
 * own target would put a 20 px control inside a 60 px one — two hit areas where
 * the user sees one thing.
 */
const LABEL_COLOR: Record<TagVariant, 'accent' | 'accentText' | 'textSecondary'> = {
  outline: 'accent',
  accent: 'accentText',
  neutral: 'textSecondary',
};

export function Tag({label, variant = 'outline', icon, style}: TagProps): React.JSX.Element {
  const styles = useStyles();

  return (
    <View style={[styles.base, styles[variant], style]}>
      {icon}
      <Text variant="micro" color={LABEL_COLOR[variant]}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.smd,
    paddingVertical: 3,
    borderRadius: theme.radius.xs,
  },
  outline: {
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  accent: {
    backgroundColor: theme.colors.accentFill,
  },
  neutral: {
    backgroundColor: theme.colors.pressedWash,
  },
}));
