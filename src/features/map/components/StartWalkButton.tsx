import React from 'react';

import {View} from 'react-native';

import {Button, Icon} from '@components/index';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {Pulse} from './Pulse';

export interface StartWalkButtonProps {
  label: string;
  loading?: boolean;
  onPress: () => void;
}

/**
 * The one thing the map is for.
 *
 * A standard outlined primary button sitting on a pulsing accent halo. The halo
 * is a sibling that scales *behind* the button rather than a shadow on it, so
 * the glow bleeds past the edges while the face stays opaque — a translucent
 * face would let the pulse wash over the label and make it flicker.
 */
export function StartWalkButton({
  label,
  loading = false,
  onPress,
}: StartWalkButtonProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.wrap}>
      <Pulse durationMs={theme.durations.pulse} style={styles.glow} />
      <Button
        label={label}
        icon={<Icon name="walk" size={19} color="accent" />}
        loading={loading}
        onPress={onPress}
        style={styles.button}
      />
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  wrap: {
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentGlow,
  },
  button: {
    // Taller than the 48 dp floor: this is the screen's single primary action
    // and the design gives it the extra weight.
    minHeight: 56,
    // Opaque, so the halo reads as a glow around the button and not through it.
    backgroundColor: theme.colors.background,
  },
}));
