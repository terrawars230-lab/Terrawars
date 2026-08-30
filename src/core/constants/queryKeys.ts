/**
 * Centralised React Query key factory.
 *
 * Keys are declared in one place so an invalidation after a mutation can never
 * miss a cache entry because two call sites spelled the key differently.
 * Convention: `[domain, ...discriminators]`, most general first, so a
 * prefix-match invalidation (`['parcels']`) clears every viewport.
 */

import type {MapBounds} from '@core/types/geo';

export const queryKeys = {
  session: ['session'] as const,

  profile: {
    all: ['profile'] as const,
    me: () => [...queryKeys.profile.all, 'me'] as const,
    byUsername: (username: string) => [...queryKeys.profile.all, 'username', username] as const,
    usernameAvailability: (username: string) =>
      [...queryKeys.profile.all, 'availability', username] as const,
  },

  gameConfig: ['gameConfig'] as const,

  walks: {
    all: ['walks'] as const,
    active: () => [...queryKeys.walks.all, 'active'] as const,
    history: () => [...queryKeys.walks.all, 'history'] as const,
    detail: (walkId: string) => [...queryKeys.walks.all, 'detail', walkId] as const,
  },

  parcels: {
    all: ['parcels'] as const,
    inBounds: (bounds: MapBounds, zoom: number) =>
      [...queryKeys.parcels.all, 'bbox', roundBounds(bounds), zoom] as const,
    detail: (parcelId: string) => [...queryKeys.parcels.all, 'detail', parcelId] as const,
    mine: () => [...queryKeys.parcels.all, 'mine'] as const,
  },

  leaderboards: {
    all: ['leaderboards'] as const,
    global: () => [...queryKeys.leaderboards.all, 'global'] as const,
    weekly: () => [...queryKeys.leaderboards.all, 'weekly'] as const,
    local: (city: string) => [...queryKeys.leaderboards.all, 'local', city] as const,
  },

  stealEvents: {
    all: ['stealEvents'] as const,
    byDirection: (direction: 'incoming' | 'outgoing') =>
      [...queryKeys.stealEvents.all, direction] as const,
  },
} as const;

/**
 * Snap a viewport to ~11 m of precision before it becomes a cache key.
 *
 * Without this, every pixel of map pan mints a brand-new key and the cache
 * never hits. Four decimal places is finer than any parcel boundary we render.
 */
function roundBounds(bounds: MapBounds): MapBounds {
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  return {
    minLat: round(bounds.minLat),
    minLng: round(bounds.minLng),
    maxLat: round(bounds.maxLat),
    maxLng: round(bounds.maxLng),
  };
}
