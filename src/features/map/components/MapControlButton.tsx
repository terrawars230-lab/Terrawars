import React from 'react';

import {Pressable} from 'react-native';

import {Icon, type IconName} from '@components/index';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

export interface MapControlButtonProps {
  icon: IconName;
  /** Sole content of the control, so this is the only thing a screen reader gets. */
  label: string;
  hint?: string;
  /** Turns the glyph accent — the layers button uses it to show the filter is on. */
  active?: boolean;
  /** Dims the glyph without disabling: the control still routes somewhere useful. */
  muted?: boolean;
  busy?: boolean;
  onPress: () => void;
}

/**
 * A round control resting on the map: recentre, layers.
 *
 * Nocturne draws these at 44 px. NFR-10 wants 48 dp of *touch*, so the box stays
 * 44 and `hitSlop` adds the rest — the design's proportions and the
 * accessibility floor are both met, instead of one quietly losing to the other.
 */
export function MapControlButton({
  icon,
  label,
  hint,
  active = false,
  muted = false,
  busy = false,
  onPress,
}: MapControlButtonProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  const slop = (theme.layout.minTouchTarget - theme.layout.controlSize) / 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{selected: active, busy}}
      hitSlop={slop}
      onPress={onPress}
      style={({pressed}) => [styles.button, pressed && styles.pressed]}>
      <Icon name={icon} size={20} color={active ? 'accent' : muted ? 'tabInactive' : 'iconInactive'} />
    </Pressable>
  );
}

const useStyles = makeStyles(theme => ({
  button: {
    width: theme.layout.controlSize,
    height: theme.layout.controlSize,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    ...theme.shadows.sm,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceElevated,
  },
}));
