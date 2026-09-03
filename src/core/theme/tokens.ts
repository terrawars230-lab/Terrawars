/**
 * Design tokens — the Nocturne dark theme.
 *
 * Raw values live here and nowhere else. A component imports `useTheme()` and
 * reads semantic names (`colors.surface`), never a hex literal — that is what
 * makes a dark-mode pass or a rebrand a change in one file instead of two
 * hundred.
 */

import type {TextStyle, ViewStyle} from 'react-native';

/**
 * Nocturne — the design system the app is drawn in.
 *
 * Dark only, and deliberately so: the map is the product, and a light chrome
 * over dark tiles (or the reverse) reads as a half-finished theme. The ramps
 * were generated in OKLCH on one shared lightness scale, so the same step of
 * any role matches the others in visual value.
 */
const palette = {
  bg: '#161826',
  surface: '#232532',
  surfaceRaised: '#292b31',
  text: '#e9e9ed',

  // Blurple accent + the ramp steps the UI actually names. `accent` clears AA
  // as text on the ground (5.4:1) but not AAA, so it is used for lines,
  // borders, marks and button labels; `accent300` is the step for the small
  // accent text the HUD is full of, at a comfortable 11.8:1.
  accent: '#9184d9',
  accent2: '#a7a1db',
  accent300: '#d2cefd',
  accent800: '#423a6a',
  accent900: '#2b2741',

  neutral400: '#b2b6ca',
  neutral500: '#9397ab',
  neutral700: '#595d6c',
  neutral800: '#3f424d',

  // Status. Shared with the territory palette below on purpose — a red that
  // means "danger" and a red that means "that player" should not be two
  // slightly different reds on one screen.
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  success: '#10B981',
} as const;

/**
 * Alpha tints of the two ground colours.
 *
 * Nocturne expresses these as `color-mix(in srgb, var(--color-text) 55%,
 * transparent)`. React Native has no `color-mix`, so the mixes the system
 * actually uses are resolved once, here, rather than hand-typed as rgba() at
 * each call site — which is how two "muted" greys end up 3% apart.
 */
const alpha = {
  text70: 'rgba(233, 233, 237, 0.70)',
  text55: 'rgba(233, 233, 237, 0.55)',
  text16: 'rgba(233, 233, 237, 0.16)',
  text07: 'rgba(233, 233, 237, 0.07)',

  /** The surface at 90%, so map tiles read faintly through floating chrome. */
  surface90: 'rgba(35, 37, 50, 0.90)',
  surface93: 'rgba(35, 37, 50, 0.93)',

  accent18: 'rgba(145, 132, 217, 0.18)',
  accent16: 'rgba(145, 132, 217, 0.16)',
  accent12: 'rgba(145, 132, 217, 0.12)',
  accent800at40: 'rgba(66, 58, 106, 0.40)',
} as const;

/**
 * The ten territory colours a player can be assigned (FR-03).
 *
 * Must match `assign_signup_color` in the profiles migration exactly — the
 * server picks the index, the client only renders it. Chosen to stay
 * distinguishable from each other AND from map tile greens and greys.
 */
export const TERRITORY_COLORS = [
  '#3B82F6',
  '#EF4444',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
] as const;

/** Owner colour for parcels of deleted accounts (doc 06 §5). */
export const DELETED_OWNER_COLOR = '#9CA3AF';

/**
 * 4 pt base scale, plus the two half-steps Nocturne's own rhythm needs
 * (its spacing unit is 2.8px, so its 10/22/26px gaps do not land on a pure
 * multiple of four). Every margin and padding in the app is one of these — an
 * arbitrary `marginTop: 13` is how a layout stops being a system.
 */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  smd: 10,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 26,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  none: 0,
  /** Small swatches. */
  xs: 8,
  /** List chips, parcel swatches. */
  sm: 10,
  /** HUD cards, map buttons. */
  md: 12,
  /** Cards, avatars. */
  lg: 14,
  /** Bottom-sheet top corners. */
  xl: 22,
  pill: 99,
} as const;

/**
 * NFR-10: every interactive target is at least 48 dp, and the app must survive
 * system font scaling to 200%.
 *
 * Nocturne draws several controls at 44 px. That is a *visual* size — the
 * controls keep a 48 dp touch target via `hitSlop`, so the design and the
 * accessibility requirement are both satisfied rather than one losing.
 */
export const layout = {
  minTouchTarget: 48,
  /** Nocturne's drawn size for the round map controls and list rows. */
  controlSize: 44,
  screenPaddingHorizontal: 20,
  /** Inset for chrome floating over the map. */
  hudInset: 14,
  /** Height of the walk HUD sheet resting over the map. */
  hudCollapsedHeight: 132,
} as const;

interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle['fontWeight'];
  letterSpacing?: number;
  textTransform?: TextStyle['textTransform'];
}

export type TypographyVariant =
  | 'statHero'
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'labelStrong'
  | 'caption'
  | 'micro'
  | 'kicker'
  | 'metric'
  | 'metricLabel'
  | 'tiny';

/**
 * The type scale.
 *
 * `maxFontSizeMultiplier` is deliberately absent. NFR-10 requires 200% scaling
 * to work, so text is never capped — layouts flex instead.
 *
 * Headings stop at weight 500: Nocturne's headings are set in Inter at 500 and
 * bolding them past that flattens the contrast between a heading and the
 * emphasis weight (600) used inside body copy.
 */
export const typography: Record<TypographyVariant, TypeToken> = {
  /** The one huge number on a screen: profile total area, claim gained. */
  statHero: {fontSize: 36, lineHeight: 42, fontWeight: '500'},
  /** Onboarding H1. */
  display: {fontSize: 30, lineHeight: 35, fontWeight: '500'},
  /** Screen H1. */
  title1: {fontSize: 24, lineHeight: 30, fontWeight: '500'},
  /** Settings H1, bottom-sheet titles. */
  title2: {fontSize: 20, lineHeight: 26, fontWeight: '500'},
  /** Profile name, stat values. */
  title3: {fontSize: 19, lineHeight: 24, fontWeight: '600'},
  body: {fontSize: 15, lineHeight: 22, fontWeight: '400'},
  /** CTA labels. */
  bodyStrong: {fontSize: 16, lineHeight: 22, fontWeight: '600'},
  /** List rows. */
  label: {fontSize: 14, lineHeight: 20, fontWeight: '400'},
  /** The value at the end of a list row. */
  labelStrong: {fontSize: 13.5, lineHeight: 19, fontWeight: '600'},
  caption: {fontSize: 12.5, lineHeight: 17, fontWeight: '400'},
  micro: {fontSize: 11.5, lineHeight: 15, fontWeight: '400'},
  /** Uppercase section kicker, in accent or muted. */
  kicker: {fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase'},
  /** Live walk metrics — tabular in feel, so digits do not jitter as they tick. */
  metric: {fontSize: 24, lineHeight: 29, fontWeight: '700'},
  metricLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  /** Tab labels and the HUD's supporting lines — the floor of the scale. */
  tiny: {fontSize: 10.5, lineHeight: 14, fontWeight: '500'},
};

export const durations = {
  fast: 120,
  normal: 220,
  slow: 360,
  /** The HUD's ambient pulses — marker halo, CTA glow, live dot. */
  pulse: 2800,
} as const;

/**
 * Elevation.
 *
 * Nocturne's shadows are a hairline ring plus ambient darkness. React Native
 * cannot stack two shadows on one view, so the ring is left to the consumer's
 * `borderColor` (that is why every HUD surface in the design carries a
 * `hudBorder`) and these carry only the ambient part.
 */
export const shadows: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 6,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.65,
    shadowRadius: 24,
    elevation: 16,
  },
};

/** Semantic colour roles. */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  /** Chrome floating over the map — translucent, so the tiles show through. */
  hudSurface: string;
  /** The same, for chrome that must stay legible over a parcel fill. */
  hudSurfaceSolid: string;
  /** Border on chrome floating over the map, and the progress-bar track. */
  hudBorder: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on an accent-filled surface. */
  textInverse: string;

  accent: string;
  accentPressed: string;
  onAccent: string;
  /** The accent ramp step for small accent text — 11.8:1 on the ground. */
  accentText: string;
  /** Tinted accent fill: icon badges, the logo tile, the claim preview. */
  accentFill: string;
  /** Highlighted row (your own line on a leaderboard). */
  accentHighlight: string;
  /** The pulsing glow behind the Start Walk CTA. */
  accentGlow: string;
  /** Pressed state for accent-bearing controls. */
  accentWash: string;
  /** Pressed state for neutral controls. */
  pressedWash: string;

  /** Icon that is present but not active, on a surface. */
  iconInactive: string;
  /** Inactive tab label and icon. */
  tabInactive: string;
  /** Switch track when off, inactive page dots. */
  controlOff: string;

  danger: string;
  warning: string;
  info: string;
  success: string;

  /** Live walk trail drawn over the map (FR-13). */
  trail: string;
  /** Fill of the advisory claim preview polygon (FR-14/FR-18). */
  previewFill: string;
  previewStroke: string;
  /** Outline marking a protected parcel (FR-41). */
  protectedStroke: string;

  scrim: string;
}

export const nocturneColors: ThemeColors = {
  background: palette.bg,
  surface: palette.surface,
  surfaceElevated: palette.surfaceRaised,
  border: alpha.text16,
  hudSurface: alpha.surface90,
  hudSurfaceSolid: alpha.surface93,
  hudBorder: palette.neutral800,

  textPrimary: palette.text,
  textSecondary: alpha.text70,
  textTertiary: alpha.text55,
  textInverse: palette.bg,

  accent: palette.accent,
  accentPressed: palette.accent2,
  onAccent: palette.bg,
  accentText: palette.accent300,
  accentFill: palette.accent800,
  accentHighlight: palette.accent900,
  accentGlow: alpha.accent18,
  accentWash: alpha.accent12,
  pressedWash: alpha.text07,

  iconInactive: palette.neutral400,
  tabInactive: palette.neutral500,
  controlOff: palette.neutral700,

  danger: palette.danger,
  warning: palette.warning,
  info: palette.info,
  success: palette.success,

  trail: palette.accent,
  previewFill: alpha.accent800at40,
  previewStroke: palette.accent,
  // Nocturne marks a protected parcel with the accent's lighter twin rather
  // than a warning colour: protection is a state of the land, not an alert.
  protectedStroke: palette.accent2,

  scrim: 'rgba(10, 11, 18, 0.6)',
};

/** The user's own position marker: a halo at 16% over an accent dot. */
export const markerHalo = alpha.accent16;

export {palette};
