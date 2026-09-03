import React from 'react';

import {View} from 'react-native';

import {Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';
import {TERRITORY_COLORS} from '@core/theme/tokens';

export interface LeaderboardPreviewProps {
  /** Copy for the highlighted row — the player has no username yet. */
  youLabel: string;
  /**
   * Formats an area for display. Passed in rather than imported so the doc 03
   * §4 rule stays applied through the localisation layer at the call site.
   */
  formatAreaLabel: (areaM2: number) => string;
}

/**
 * A still of the leaderboard, shown before the player has one.
 *
 * Illustration, not data: this runs before sign-up, so there is no session to
 * fetch a real board with. The names are invented and the shape is honest —
 * rank, colour, name, area — so the real screen is recognisable when it
 * arrives. The rows sit mid-table on purpose: showing the player a #1 they have
 * not earned sets the wrong expectation, and #6 is somewhere to climb from.
 */

interface PreviewRow {
  rank: number;
  name: string;
  colorIndex: number;
  areaM2: number;
  isYou?: true;
}

const ROWS: readonly PreviewRow[] = [
  {rank: 4, name: 'ridge_walker', colorIndex: 1, areaM2: 27_410},
  {rank: 5, name: 'east_line', colorIndex: 8, areaM2: 24_980},
  {rank: 6, name: '', colorIndex: 0, areaM2: 18_940, isYou: true},
  {rank: 7, name: 'lowtide', colorIndex: 5, areaM2: 15_200},
];

export function LeaderboardPreview({
  youLabel,
  formatAreaLabel,
}: LeaderboardPreviewProps): React.JSX.Element {
  const styles = useStyles();

  return (
    <View style={styles.list}>
      {ROWS.map(row => (
        <View key={row.rank} style={[styles.row, row.isYou === true && styles.rowMine]}>
          <Text variant="caption" color="textTertiary" style={styles.rank}>
            {row.rank}
          </Text>
          <View style={[styles.dot, {backgroundColor: TERRITORY_COLORS[row.colorIndex]}]} />
          <Text variant="labelStrong" style={styles.name} numberOfLines={1}>
            {row.isYou === true ? youLabel : row.name}
          </Text>
          <Text variant="caption" color="textSecondary">
            {formatAreaLabel(row.areaM2)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.smd,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowMine: {
    backgroundColor: theme.colors.accentHighlight,
    borderColor: theme.colors.accent,
  },
  rank: {
    width: 18,
    fontWeight: '600',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.pill,
  },
  name: {
    flex: 1,
    fontWeight: '400',
  },
}));
