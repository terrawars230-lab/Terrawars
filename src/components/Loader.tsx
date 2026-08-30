import React from 'react';

import {ActivityIndicator, View} from 'react-native';

import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {Text} from './Text';

export interface LoaderProps {
  label?: string;
  /** Fills its parent and centres. Off for inline use inside a row. */
  fullscreen?: boolean;
}

export function Loader({label, fullscreen = true}: LoaderProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View
      style={fullscreen ? styles.fullscreen : styles.inline}
      accessibilityRole="progressbar"
      accessibilityLabel={label}>
      <ActivityIndicator color={theme.colors.accent} size={fullscreen ? 'large' : 'small'} />
      {label ? (
        <Text variant="caption" color="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  fullscreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  label: {
    marginTop: theme.spacing.xs,
  },
}));
