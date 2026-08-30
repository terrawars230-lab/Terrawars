import type {LinkingOptions} from '@react-navigation/native';

import type {RootStackParamList} from './types';

/**
 * Deep-link configuration.
 *
 * Two links matter in v1:
 *
 *  - `terrawars://auth/callback` — the OAuth redirect. React Native has no URL
 *    bar for supabase-js to read a session out of, so `detectSessionInUrl` is
 *    off in the client and the PKCE code arrives here instead.
 *  - `terrawars://map?lat=..&lng=..&parcelId=..` — FR-42: tapping a raid
 *    notification opens that spot on the map. A push that just opens the app is
 *    a wasted notification; the user wants to see what they lost.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['terrawars://', 'https://terrawars.app'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          MapTab: {
            path: 'map',
            parse: {
              // Coordinates arrive as strings and must become the `focus`
              // LatLng the map screen expects. A NaN here would silently
              // recentre the map on the Gulf of Guinea, so it is validated.
              focus: (value: string) => parseLatLng(value),
            },
            stringify: {
              focus: (value: {lat: number; lng: number} | undefined) =>
                value ? `${value.lat},${value.lng}` : '',
            },
          },
          LeaderboardTab: 'leaderboard',
          ProfileTab: 'profile',
        },
      },
      ParcelDetail: 'parcel/:parcelId',
      PublicProfile: 'player/:username',
      Settings: 'settings',
    },
  },
};

function parseLatLng(value: string): {lat: number; lng: number} | undefined {
  const [latText, lngText] = value.split(',');
  const lat = Number(latText);
  const lng = Number(lngText);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined;
  }
  return {lat, lng};
}

/** True for the Supabase OAuth callback, which navigation should ignore. */
export function isAuthCallbackUrl(url: string): boolean {
  return url.startsWith('terrawars://auth');
}
