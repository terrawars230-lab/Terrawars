import React from 'react';

import Svg, {Circle, Path, type NumberProp} from 'react-native-svg';

import {useTheme} from '@core/theme/ThemeProvider';

/**
 * The app's icon set.
 *
 * Hand-drawn paths on `react-native-svg` rather than an icon font. Two reasons
 * that matter here: a font ships a whole glyph set and needs per-platform link
 * steps that break on a `pod install` someone forgot, and — the one that
 * decided it — icons drawn over map tiles need a stroke that responds to the
 * theme, which a font glyph cannot do.
 *
 * Every icon is on a 24×24 grid, stroked not filled, so they sit together at
 * any size. They are decorative by default: the label beside them carries the
 * meaning, and `accessibilityElementsHidden` keeps a screen reader from
 * announcing a shape twice. Pass a `label` only when an icon is genuinely
 * alone, as in the map's round controls.
 */

type ThemeColorRole = keyof ReturnType<typeof useTheme>['colors'];

export type IconName =
  | 'map'
  | 'trophy'
  | 'user'
  | 'crosshair'
  | 'layers'
  | 'play'
  | 'pause'
  | 'flag'
  | 'trash'
  | 'walk'
  | 'settings'
  | 'alert';

export interface IconProps {
  name: IconName;
  /** Defaults to 24 — the grid the paths are drawn on. */
  size?: NumberProp;
  /**
   * A theme colour role, or a raw colour value — the tab bar hands us the tint
   * it has already resolved for the active state, which is not a role name.
   */
  color?: ThemeColorRole | (string & {});
  strokeWidth?: NumberProp;
  /** Set only when the icon is the sole content of a control. */
  label?: string;
}

/**
 * The 24×24 path data.
 *
 * `d` strings only — no per-icon components — so adding one is a single line
 * and every icon is guaranteed to share the same stroke treatment.
 */
const PATHS: Record<IconName, string[]> = {
  // A folded map: the parcels surface.
  map: ['M9 3.5 3.5 6v14.5L9 18l6 2.5 5.5-2.5V3.5L15 6 9 3.5Z', 'M9 3.5V18', 'M15 6v14.5'],
  trophy: [
    'M7 4h10v5a5 5 0 0 1-10 0V4Z',
    'M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11',
    'M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11',
    'M12 14v3.5',
    'M8.5 20.5h7',
  ],
  user: ['M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  // Crosshair — "centre on me". The dot is drawn as a separate filled circle.
  crosshair: ['M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z', 'M12 2v3.5', 'M12 18.5V22', 'M2 12h3.5', 'M18.5 12H22'],
  // Stacked sheets — the "my land only" filter.
  layers: ['M12 3 3 7.5l9 4.5 9-4.5L12 3Z', 'M3 12.5 12 17l9-4.5', 'M3 17 12 21.5l9-4.5'],
  play: ['M8 5.5v13l11-6.5-11-6.5Z'],
  pause: ['M9 5.5v13', 'M15 5.5v13'],
  flag: ['M6 21V4', 'M6 4.5h11l-2 4 2 4H6'],
  trash: ['M4.5 6.5h15', 'M9.5 6.5V4h5v2.5', 'M6.5 6.5 7.5 20h9l1-13.5', 'M10.5 10v6', 'M13.5 10v6'],
  // A walking figure — the start-walk affordance.
  walk: ['M13.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M11 21.5l1.5-6L10 13V9l3.5-1.5L16 10l2.5 1', 'M10 13l-2.5 3.5', 'M12.5 15.5 15 18l.5 3.5'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.5 12a7.6 7.6 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2.1-1.2L14.6 3h-4l-.4 2.7a7.5 7.5 0 0 0-2.1 1.2l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2.1 1.2l.4 2.7h4l.4-2.7a7.5 7.5 0 0 0 2.1-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z',
  ],
  alert: ['M12 3.5 2.5 20h19L12 3.5Z', 'M12 9.5v5'],
};

/** Icons that need a solid dot the stroke cannot express. */
const CENTRE_DOT: Partial<Record<IconName, number>> = {crosshair: 1.6};

/** Icons whose shape only reads when filled. */
const FILLED: Partial<Record<IconName, true>> = {play: true};

export function Icon({
  name,
  size = 24,
  color = 'textPrimary',
  strokeWidth = 1.8,
  label,
}: IconProps): React.JSX.Element {
  const theme = useTheme();
  // A theme role wins; anything else is passed through, which is what lets the
  // tab bar hand us the tint it already computed for the active state.
  const resolved = color in theme.colors ? theme.colors[color as ThemeColorRole] : color;
  const filled = FILLED[name] === true;
  const dot = CENTRE_DOT[name];

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}>
      {PATHS[name].map((d, index) => (
        <Path
          key={index}
          d={d}
          stroke={resolved}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? resolved : 'none'}
        />
      ))}
      {dot !== undefined ? <Circle cx={12} cy={12} r={dot} fill={resolved} /> : null}
    </Svg>
  );
}
