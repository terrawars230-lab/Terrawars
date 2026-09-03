import React from 'react';

import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {Text} from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'large' | 'medium';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered before the label. Keep it decorative — the label carries the meaning. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'primary',
  size = 'large',
  loading = false,
  fullWidth = true,
  icon,
  disabled,
  style,
  ...rest
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  const isDisabled = disabled || loading;

  // Nocturne's buttons are outlines, not fills: the accent is a *line* colour,
  // and a screen of accent-filled slabs over a near-black ground is where the
  // system stops looking like itself. `danger` stays filled — a destructive
  // action is the one place the extra weight is the point.
  const outline: Record<ButtonVariant, string | undefined> = {
    primary: theme.colors.accent,
    secondary: theme.colors.border,
    ghost: undefined,
    danger: undefined,
  };

  const labelColorByVariant: Record<ButtonVariant, Parameters<typeof Text>[0]['color']> = {
    primary: 'accent',
    secondary: 'textPrimary',
    ghost: 'accent',
    danger: 'textInverse',
  };

  // NFR-10 and the design agree here, but only because the pressed state is
  // themed: a default platform highlight over a translucent outline reads as a
  // rendering glitch on this ground.
  const pressedFill: Record<ButtonVariant, string> = {
    primary: theme.colors.accentWash,
    secondary: theme.colors.pressedWash,
    ghost: theme.colors.accentWash,
    danger: theme.colors.danger,
  };

  const borderColor = outline[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Communicates the disabled state to screen readers, which a greyed-out
      // background alone does not (NFR-10).
      accessibilityState={{disabled: Boolean(isDisabled), busy: loading}}
      disabled={isDisabled}
      style={({pressed}) => [
        styles.base,
        size === 'medium' && styles.medium,
        fullWidth && styles.fullWidth,
        variant === 'danger' && {backgroundColor: theme.colors.danger},
        borderColor !== undefined && {borderWidth: 1, borderColor},
        pressed && !isDisabled && {backgroundColor: pressedFill[variant]},
        pressed && variant === 'danger' && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'danger' ? theme.colors.textInverse : theme.colors.accent}
        />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text variant="bodyStrong" color={labelColorByVariant[variant]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(theme => ({
  base: {
    // NFR-10: every interactive target is at least 48 dp.
    minHeight: theme.layout.minTouchTarget,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medium: {
    minHeight: theme.layout.minTouchTarget,
    paddingHorizontal: theme.spacing.lg,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
}));
