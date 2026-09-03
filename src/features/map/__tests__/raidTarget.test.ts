import type {ParcelFeature} from '../api/mapApi';
import {isParcelProtected, pickRaidTarget} from '../utils/raidTarget';

/**
 * The raid suggestion is advisory, but it is the map's single call to action —
 * suggesting your own land, or land the server will refuse to transfer because
 * it is still protected (FR-41), sends the player on a walk that cannot pay
 * off. That reads as a scoring bug, not a UI one.
 */

const NOW = new Date('2026-09-03T12:00:00Z');

/** A square parcel roughly `metresEast` east of the origin used in the tests. */
function parcelAt(
  id: string,
  lat: number,
  lng: number,
  overrides: Partial<ParcelFeature> = {},
): ParcelFeature {
  const d = 0.0005;
  return {
    id,
    polygon: {
      outer: [
        {lat: lat - d, lng: lng - d},
        {lat: lat - d, lng: lng + d},
        {lat: lat + d, lng: lng + d},
        {lat: lat + d, lng: lng - d},
      ],
    },
    ownerId: `owner-${id}`,
    ownerUsername: `player_${id}`,
    colorHex: '#EF4444',
    areaM2: 1000,
    claimedAt: '2026-09-01T00:00:00Z',
    protectedUntil: null,
    isMine: false,
    ...overrides,
  };
}

const HERE = {lat: 31.5204, lng: 74.3587};

describe('isParcelProtected', () => {
  it('is false when the parcel has never been protected', () => {
    expect(isParcelProtected(parcelAt('a', 31.52, 74.35), NOW)).toBe(false);
  });

  it('is true while the window is open', () => {
    const parcel = parcelAt('a', 31.52, 74.35, {protectedUntil: '2026-09-03T18:00:00Z'});
    expect(isParcelProtected(parcel, NOW)).toBe(true);
  });

  it('is false once the window has passed', () => {
    const parcel = parcelAt('a', 31.52, 74.35, {protectedUntil: '2026-09-03T06:00:00Z'});
    expect(isParcelProtected(parcel, NOW)).toBe(false);
  });

  it('treats an unparseable timestamp as unprotected rather than hiding the parcel', () => {
    const parcel = parcelAt('a', 31.52, 74.35, {protectedUntil: 'not-a-date'});
    expect(isParcelProtected(parcel, NOW)).toBe(false);
  });
});

describe('pickRaidTarget', () => {
  it('returns null without a position fix', () => {
    expect(pickRaidTarget([parcelAt('a', 31.52, 74.35)], null, NOW)).toBeNull();
  });

  it('returns null when the viewport holds nothing raidable', () => {
    expect(pickRaidTarget([], HERE, NOW)).toBeNull();
  });

  it('picks the nearest rival parcel', () => {
    const near = parcelAt('near', 31.5209, 74.3587);
    const far = parcelAt('far', 31.5304, 74.3587);

    const target = pickRaidTarget([far, near], HERE, NOW);

    expect(target?.parcel.id).toBe('near');
    // ~0.0005° of latitude is ~55 m; the exact value is haversine's business.
    expect(target?.distanceM).toBeLessThan(200);
  });

  it('never suggests your own land', () => {
    const mine = parcelAt('mine', 31.5205, 74.3587, {isMine: true});
    const theirs = parcelAt('theirs', 31.5304, 74.3587);

    expect(pickRaidTarget([mine, theirs], HERE, NOW)?.parcel.id).toBe('theirs');
  });

  it('skips a closer parcel that is still protected (FR-41)', () => {
    const shielded = parcelAt('shielded', 31.5205, 74.3587, {
      protectedUntil: '2026-09-03T18:00:00Z',
    });
    const open = parcelAt('open', 31.5304, 74.3587);

    expect(pickRaidTarget([shielded, open], HERE, NOW)?.parcel.id).toBe('open');
  });

  it('skips a degenerate polygon rather than throwing on its centroid', () => {
    const broken = parcelAt('broken', 31.5205, 74.3587);
    broken.polygon.outer = [];
    const open = parcelAt('open', 31.5304, 74.3587);

    expect(pickRaidTarget([broken, open], HERE, NOW)?.parcel.id).toBe('open');
  });
});
