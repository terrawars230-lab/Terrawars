import React from 'react';

import {View} from 'react-native';

import {Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';

export interface WeeklyContractCardProps {
  /** Uppercase kicker, e.g. "Weekly contract". */
  title: string;
  /** Right-aligned progress readout, e.g. "3,120 / 5,000 m²". */
  progressLabel: string;
  /** 0–1. Clamped here so a negative weekly score cannot draw outside the track. */
  progress: number;
  /** Read out in place of the bar for screen readers. */
  accessibilityLabel: string;
}

/**
 * The week's goal (FR-61).
 *
 * Backed by `weekly_scores.area_gained_m2`, which is the same number the weekly
 * leaderboard ranks on — so the bar and the board can never disagree. That
 * score goes NEGATIVE when a player is raided harder than they claimed
 * (doc 03 §4), which is why `progress` is clamped rather than trusted: a bar
 * drawn at -40% renders as a full-width bar in the other direction.
 */
export function WeeklyContractCard({
  title,
  progressLabel,
  progress,
  accessibilityLabel,
}: WeeklyContractCardProps): React.JSX.Element {
  const styles = useStyles();
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text variant="metricLabel" color="accentText" style={styles.title}>
          {title}
        </Text>
        <Text variant="micro" color="textSecondary">
          {progressLabel}
        </Text>
      </View>

      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{min: 0, max: 100, now: Math.round(clamped * 100)}}
        style={styles.track}>
        <View style={[styles.fill, {width: `${clamped * 100}%`}]} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.hudSurface,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
    ...theme.shadows.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.spacing.smd,
  },
  title: {
    // Yields to the readout: the goal changes weekly, the label never does.
    flexShrink: 1,
  },
  track: {
    height: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.hudBorder,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
  },
}));
