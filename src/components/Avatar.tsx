import React, {useState} from 'react';

import {Image, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {makeStyles} from '@core/theme/ThemeProvider';
import {safeColor, withAlpha} from '@core/utils/color';

import {Text} from './Text';

export interface AvatarProps {
  /** The player's uploaded photo. Null for most players, so the fallback matters. */
  uri?: string | null;
  /** Used for the fallback initial and the accessibility label. */
  username: string;
  /** Drawn size. Nocturne uses 30 (HUD pill), 52 (sheets) and 56 (profile). */
  size: number;
  /** The player's territory colour — what makes a fallback avatar *theirs*. */
  colorHex?: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * A player's face.
 *
 * The fallback is not a generic grey silhouette: it is the player's own
 * territory colour with their initial on it, so the avatar in a leaderboard row
 * and the parcel on the map are recognisably the same person before the name is
 * read. Most players never upload a photo, which makes the fallback the common
 * case rather than the edge one.
 *
 * The photo is layered OVER that tile rather than replacing it, which buys two
 * things for free: the coloured tile is what shows while the image is still
 * downloading, and a dead URL degrades to the same tile instead of a broken
 * image box.
 */
export function Avatar({uri, username, size, colorHex, style}: AvatarProps): React.JSX.Element {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);

  const color = safeColor(colorHex);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={username}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(color, 0.28),
          borderColor: color,
        },
        style,
      ]}>
      <Text
        // Scales with the tile so one component covers 30 px and 56 px without
        // a per-size font token.
        style={{fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.52)}}
        color="textPrimary">
        {initialOf(username)}
      </Text>

      {uri && !failed ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{uri}}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

/**
 * `Array.from` rather than `charAt(0)`: slicing a surrogate pair leaves half a
 * code point, which renders as a replacement glyph. Usernames are 3–20
 * characters of whatever the server accepted.
 */
function initialOf(username: string): string {
  const [first] = Array.from(username.trim());
  return first ? first.toUpperCase() : '?';
}

const useStyles = makeStyles(() => ({
  tile: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
}));
