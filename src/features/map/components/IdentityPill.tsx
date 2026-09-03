import React from 'react';

import {View} from 'react-native';

import {Avatar, Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';

export interface IdentityPillProps {
  username: string;
  avatarUrl: string | null;
  colorHex: string;
  /**
   * The second line — "1,240 m² held · #6".
   *
   * Arrives already formatted and localised. Area formatting is a doc 03 §4
   * rule that the server mirrors exactly, so it belongs in `utils/format`
   * called from the screen, not in a piece of HUD chrome.
   */
  subtitle: string;
}

/** Nocturne draws the HUD avatar at 30. */
const AVATAR_SIZE = 30;

/**
 * Who you are and how you are doing, resting on the map.
 *
 * The one piece of the HUD that is always on screen, so it carries the two
 * numbers a player checks constantly — area held and rank — rather than making
 * them a trip to the profile tab.
 *
 * Not pressable: the profile is a tab, one thumb-reach away at the bottom of
 * the screen, and a second route to it here would put a control in the corner
 * the map's own gestures start from.
 */
export function IdentityPill({
  username,
  avatarUrl,
  colorHex,
  subtitle,
}: IdentityPillProps): React.JSX.Element {
  const styles = useStyles();

  return (
    <View style={styles.pill}>
      <Avatar uri={avatarUrl} username={username} colorHex={colorHex} size={AVATAR_SIZE} />
      <View style={styles.lines}>
        <Text variant="caption" numberOfLines={1} style={styles.name}>
          {username}
        </Text>
        <Text variant="tiny" color="accentText" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    // Asymmetric: the avatar is already a circle inset by the pill's own
    // radius, so matching the right-hand padding would leave it adrift.
    paddingLeft: 5,
    paddingRight: theme.spacing.lg,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.hudSurface,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
    // Shrinks before the streak/status chip beside it does, and never pushes it
    // off-screen when a long username meets 200% font scaling (NFR-10).
    flexShrink: 1,
    ...theme.shadows.sm,
  },
  lines: {
    flexShrink: 1,
  },
  name: {
    fontWeight: '600',
  },
}));
