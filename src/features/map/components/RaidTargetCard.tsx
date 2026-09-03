import React from 'react';

import {Pressable, View} from 'react-native';

import {Tag, Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';
import {withAlpha} from '@core/utils/color';

export interface RaidTargetCardProps {
  /** "nightjar is exposed" — built by the screen so the copy stays localised. */
  title: string;
  /** "2,210 m² · 240 m from you". */
  detail: string;
  /** The owner's territory colour, which is how the card ties to the map. */
  colorHex: string;
  /** Label for the outline tag, e.g. "Raid". */
  tagLabel: string;
  onPress: () => void;
}

/**
 * The nearest rival parcel you could actually take.
 *
 * The map answers "who owns what"; this answers "so what do I do now", which is
 * the question a player opens the app with. Everything on it is already public:
 * a parcel polygon, its owner's name and its area (FR-51), plus a distance the
 * client works out from your own position. Nothing here needs — or gets — a
 * rival's live location.
 */
export function RaidTargetCard({
  title,
  detail,
  colorHex,
  tagLabel,
  onPress,
}: RaidTargetCardProps): React.JSX.Element {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({pressed}) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.swatch, {backgroundColor: withAlpha(colorHex, 0.85)}]} />

      <View style={styles.lines}>
        <Text variant="labelStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="micro" color="textSecondary" numberOfLines={1}>
          {detail}
        </Text>
      </View>

      <Tag label={tagLabel} variant="outline" />
    </Pressable>
  );
}

const useStyles = makeStyles(theme => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    // Solid-er than the rest of the HUD: this one sits low on the screen, where
    // it is most likely to land on a parcel fill rather than bare map.
    backgroundColor: theme.colors.hudSurfaceSolid,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
    ...theme.shadows.md,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.sm,
  },
  lines: {
    flex: 1,
    minWidth: 0,
  },
}));
