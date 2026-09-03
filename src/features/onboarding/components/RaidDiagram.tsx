import React from 'react';

import {View} from 'react-native';

import Svg, {Circle, Defs, Line, Pattern, Polygon, Rect} from 'react-native-svg';

import {Text} from '@components/index';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import {TERRITORY_COLORS} from '@core/theme/tokens';

export interface RaidDiagramProps {
  /** Legend copy — "Your land" / "Rival loop". */
  yoursLabel: string;
  rivalLabel: string;
  /** What the whole picture says, for a screen reader. */
  accessibilityLabel: string;
}

/**
 * The picture that explains the game: a rival loop cutting into your parcel.
 *
 * The one screen in onboarding where a diagram beats a sentence — "a rival who
 * walks through your territory cuts away everything their loop encloses" is
 * three clauses of geometry, and the overlap is obvious the moment it is drawn.
 *
 * The blue is `TERRITORY_COLORS[0]`, the colour a brand-new player is most
 * likely to be assigned, so the shape they are told is theirs is the colour
 * their first parcel will actually be. The rival is drawn in the accent and
 * dashed, because a walk in progress is not yet a parcel.
 */
export function RaidDiagram({
  yoursLabel,
  rivalLabel,
  accessibilityLabel,
}: RaidDiagramProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  const mine = TERRITORY_COLORS[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.canvas}>
        <Svg
          viewBox="0 0 300 196"
          width="100%"
          height="100%"
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}>
          <Defs>
            <Pattern id="grid" width={32} height={32} patternUnits="userSpaceOnUse">
              <Rect
                x={0}
                y={0}
                width={32}
                height={32}
                fill="none"
                stroke={theme.colors.border}
                strokeWidth={1}
              />
            </Pattern>
          </Defs>
          <Rect x={0} y={0} width={300} height={196} fill="url(#grid)" opacity={0.5} />

          {/* Your parcel: a settled claim, so a solid fill and a solid edge. */}
          <Polygon
            points="24,34 176,16 208,132 52,166"
            fill={mine}
            fillOpacity={0.26}
            stroke={mine}
            strokeWidth={2}
          />

          {/* The rival's loop, still being walked: dashed, tinted, not yet land. */}
          <Polygon
            points="140,74 286,52 296,178 152,190"
            fill={theme.colors.accentFill}
            fillOpacity={0.6}
            stroke={theme.colors.accent}
            strokeWidth={2}
            strokeDasharray="7 5"
          />

          {/* The cut: where their loop crosses your boundary, and what it takes. */}
          <Line x1={140} y1={74} x2={152} y2={190} stroke={theme.colors.accent} strokeWidth={3} />
          <Circle cx={140} cy={74} r={4.5} fill={theme.colors.accent} />
          <Circle cx={152} cy={190} r={4.5} fill={theme.colors.accent} />
        </Svg>
      </View>

      <View style={styles.legend}>
        <LegendItem color={mine} label={yoursLabel} />
        <LegendItem color={theme.colors.accent} label={rivalLabel} />
      </View>
    </View>
  );
}

function LegendItem({color, label}: {color: string; label: string}): React.JSX.Element {
  const styles = useStyles();
  return (
    // The legend repeats what the diagram's own accessibility label already
    // says, so a screen reader is spared the same fact three times.
    <View style={styles.legendItem} accessibilityElementsHidden>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <Text variant="micro" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  wrap: {
    gap: theme.spacing.lg,
  },
  canvas: {
    // The drawn height from the design. Fixed rather than aspect-derived so the
    // diagram keeps its size when the copy below it grows under font scaling —
    // the screen scrolls instead (NFR-10).
    height: 196,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: theme.radius.pill,
  },
}));
