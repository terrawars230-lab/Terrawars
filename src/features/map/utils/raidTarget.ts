import type {LatLng} from '@core/types/geo';
import {haversineDistanceM, ringCentroid} from '@geo/measurement';

import type {ParcelFeature} from '../api/mapApi';

/**
 * Picking the parcel to suggest raiding.
 *
 * Presentation only — it ranks parcels the viewport query already returned and
 * changes nothing about what can actually be claimed. `finish_walk` decides
 * that (CLAUDE.md rule 1), and it will happily reject a walk around the parcel
 * this suggested: the protection window can close or open between the fetch and
 * the finish, and a rival can take the land first.
 */

export interface RaidTarget {
  parcel: ParcelFeature;
  /** Straight-line metres from the player to the parcel's centroid. */
  distanceM: number;
}

/** FR-41: a parcel claimed inside the protection window cannot be taken. */
export function isParcelProtected(parcel: ParcelFeature, now: Date = new Date()): boolean {
  if (!parcel.protectedUntil) {
    return false;
  }
  const until = Date.parse(parcel.protectedUntil);
  // An unparseable timestamp is treated as NOT protected: the server is the
  // authority either way, and marking land protected on a bad string would
  // hide a legitimate target with no way for the player to tell why.
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * The nearest rival parcel that is currently open to a raid.
 *
 * Distance is to the centroid rather than the nearest edge. The edge is the
 * honest answer to "how far must I walk", but it makes the suggestion jump
 * between two parcels as the player moves along a shared boundary; the centroid
 * is stable, and the number is a rough "how far from you" either way.
 *
 * Returns null when there is no fix yet, or nothing raidable in the viewport —
 * both ordinary, and both mean the card simply does not appear.
 */
export function pickRaidTarget(
  parcels: readonly ParcelFeature[],
  from: LatLng | null,
  now: Date = new Date(),
): RaidTarget | null {
  if (!from) {
    return null;
  }

  let best: RaidTarget | null = null;

  for (const parcel of parcels) {
    if (parcel.isMine || isParcelProtected(parcel, now) || parcel.polygon.outer.length < 3) {
      continue;
    }

    const distanceM = haversineDistanceM(from, ringCentroid(parcel.polygon.outer));
    if (!best || distanceM < best.distanceM) {
      best = {parcel, distanceM};
    }
  }

  return best;
}
