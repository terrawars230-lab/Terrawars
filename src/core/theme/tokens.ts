/**
 * Design tokens.
 *
 * Raw values live here and nowhere else. A component imports `useTheme()` and
 * reads semantic names (`colors.surface`), never a hex literal — that is what
 * makes a dark-mode pass or a rebrand a change in one file instead of two
 * hundred.
 */

/** The map is the product, so the palette is built to sit ON TOP of map tiles. */
const palette = {
  // Neutrals — cool-tinted so they read as UI chrome against warm map tiles.
  black: '#0A0D14',
  gray900: '#12161F',
  gray800: '#1A1F2B',
  gray700: '#2A3140',
  gray600: '#3D4657',
  gray500: '#5A6478',
  gray400: '#8A93A6',
  gray300: '#B8BFCC',
  gray200: '#DCE0E8',
  gray100: '#EFF1F5',
  white: '#FFFFFF',

  // Brand
  green500: '#22C55E',
  green600: '#16A34A',
  green400: '#4ADE80',

  // Status
  red500: '#EF4444',
  red400: '#F87171',
  amber500: '#F59E0B',
  blue500: '#3B82F6',
  blue400: '#60A5FA',
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
 * 4 pt base scale. Every margin and padding in the app is one of these — an
 * arbitrary `marginTop: 13` is how a layout stops being a system.
 */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * NFR-10: every interactive target is at least 48 dp, and the app must survive
 * system font scaling to 200%.
 */
export const layout = {
  minTouchTarget: 48,
  screenPaddingHorizontal: spacing.lg,
  /** Height of the walk HUD sheet resting over the map. */
  hudCollapsedHeight: 132,
} as const;

export const typography = {
  /**
   * `maxFontSizeMultiplier` is deliberately absent from these tokens. NFR-10
   * requires 200% scaling to work, so text is never capped — layouts must flex
   * instead.
   */
  display: {fontSize: 34, lineHeight: 40, fontWeight: '700'},
  title1: {fontSize: 26, lineHeight: 32, fontWeight: '700'},
  title2: {fontSize: 20, lineHeight: 26, fontWeight: '600'},
  body: {fontSize: 16, lineHeight: 22, fontWeight: '400'},
  bodyStrong: {fontSize: 16, lineHeight: 22, fontWeight: '600'},
  caption: {fontSize: 13, lineHeight: 18, fontWeight: '400'},
  /** Tabular figures for the live HUD, so digits do not jitter as they tick. */
  metric: {fontSize: 30, lineHeight: 34, fontWeight: '700'},
  metricLabel: {fontSize: 11, lineHeight: 14, fontWeight: '600'},
} as const;

export type TypographyVariant = keyof typeof typography;

export const durations = {
  fast: 120,
  normal: 220,
  slow: 360,
} as const;

/** Semantic colour roles. Both themes must define every key. */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  accent: string;
  accentPressed: string;
  onAccent: string;

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

export const lightColors: ThemeColors = {
  background: palette.gray100,
  surface: palette.white,
  surfaceElevated: palette.white,
  border: palette.gray200,

  textPrimary: palette.gray900,
  textSecondary: palette.gray500,
  textTertiary: palette.gray400,
  textInverse: palette.white,

  accent: palette.green600,
  accentPressed: palette.green500,
  onAccent: palette.white,

  danger: palette.red500,
  warning: palette.amber500,
  info: palette.blue500,
  success: palette.green600,

  trail: palette.green600,
  previewFill: 'rgba(34, 197, 94, 0.22)',
  previewStroke: palette.green600,
  protectedStroke: palette.amber500,

  scrim: 'rgba(10, 13, 20, 0.55)',
};

export const darkColors: ThemeColors = {
  background: palette.black,
  surface: palette.gray900,
  surfaceElevated: palette.gray800,
  border: palette.gray700,

  textPrimary: palette.gray100,
  textSecondary: palette.gray400,
  textTertiary: palette.gray500,
  textInverse: palette.gray900,

  accent: palette.green500,
  accentPressed: palette.green400,
  onAccent: palette.black,

  danger: palette.red400,
  warning: palette.amber500,
  info: palette.blue400,
  success: palette.green400,

  trail: palette.green400,
  previewFill: 'rgba(74, 222, 128, 0.26)',
  previewStroke: palette.green400,
  protectedStroke: palette.amber500,

  scrim: 'rgba(0, 0, 0, 0.65)',
};

export {palette};
