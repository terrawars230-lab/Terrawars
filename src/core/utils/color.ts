/**
 * Colour maths for player-assigned values.
 *
 * Nocturne's own colours are tokens, already resolved (see `theme/tokens.ts`).
 * These helpers exist for the ONE family of colours the theme cannot hold: the
 * ten territory colours, which arrive per-parcel from the server as `#RRGGBB`
 * and have to be tinted at render time.
 */

import {DELETED_OWNER_COLOR} from '@core/theme/tokens';

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Applies alpha to a `#RRGGBB` colour.
 *
 * react-native-maps needs a real colour value for `fillColor`, and the owner's
 * colour arrives as a hex string. An unparseable value falls back to the
 * deleted-owner grey rather than throwing — one malformed colour must not take
 * the map down with it.
 */
/* eslint-disable no-bitwise -- unpacking a packed 24-bit colour */
export function withAlpha(hex: string, alpha: number): string {
  const match = HEX.exec(hex);
  const value = parseInt(match ? match[1]! : DELETED_OWNER_COLOR.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
/* eslint-enable no-bitwise */

/** A server colour we are willing to render, or the deleted-owner grey. */
export function safeColor(hex: string | null | undefined): string {
  return hex && HEX.test(hex) ? hex : DELETED_OWNER_COLOR;
}
