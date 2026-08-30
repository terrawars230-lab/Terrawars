import React from 'react';

import {View} from 'react-native';

import {makeStyles} from '@core/theme/ThemeProvider';

import {Button} from './Button';
import {Text} from './Text';

export interface EmptyStateProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

/**
 * The empty state every list and map surface needs (doc 07 Phase 7: "no screen
 * has an unhandled empty or error state").
 *
 * Worth taking seriously in this app specifically. doc 06 §8.5 flags the
 * empty-map cold start as a launch risk — in a new city the map is blank and
 * the game feels dead, so an empty state that says "be the first here" is
 * doing real product work, not decoration.
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  icon,
}: EmptyStateProps): React.JSX.Element {
  const styles = useStyles();

  return (
    <View style={styles.root} accessibilityRole="summary">
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text variant="title2" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" color="textSecondary" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  icon: {
    marginBottom: theme.spacing.md,
  },
  body: {
    maxWidth: 320,
  },
  action: {
    marginTop: theme.spacing.lg,
  },
}));
