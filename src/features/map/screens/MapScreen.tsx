import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Pressable, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import MapView, {Polygon as MapPolygon, PROVIDER_GOOGLE, type Region} from 'react-native-maps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Icon, Screen, Text} from '@components/index';
import {LAUNCH_CITY, REGION_DELTA} from '@core/constants/mapDefaults';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import type {LatLng, MapBounds} from '@core/types/geo';

import {fetchParcelsInBounds, type ParcelFeature} from '../api/mapApi';
import {useUserLocation} from '../hooks/useUserLocation';
import {regionToBounds, regionToZoom} from '../utils/viewport';

/**
 * The world map (FR-50 … FR-54). The app's home surface.
 *
 * Performance is a stated requirement here, not an aspiration: NFR-03 asks for
 * 45 fps while panning with 500 parcels in the viewport, and NFR-04 gives the
 * viewport query a 400 ms p95. Three things do the work:
 *
 *  - the server simplifies geometry by zoom (doc 04 §4), so the client never
 *    receives more vertices than the screen can resolve;
 *  - the region is debounced before it becomes a query, so a pan fires one
 *    request rather than sixty;
 *  - `queryKeys.parcels.inBounds` rounds the bbox, so small pans hit the cache.
 */

/** Lahore — the OQ-3 launch city. Used until the first location fix arrives. */
const INITIAL_REGION: Region = {
  ...LAUNCH_CITY,
  latitudeDelta: REGION_DELTA.city,
  longitudeDelta: REGION_DELTA.city,
};

/** How long the map must be still before the viewport becomes a query. */
const REGION_SETTLE_MS = 400;

export function MapScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const mapRef = useRef<MapView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [viewport, setViewport] = useState<{bounds: MapBounds; zoom: number}>(() => ({
    bounds: regionToBounds(INITIAL_REGION),
    zoom: regionToZoom(INITIAL_REGION.longitudeDelta),
  }));
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  // Owns the permission state and the one-shot fixes. The map cannot show a
  // blue dot without a live grant, and that grant is made on another screen.
  const location = useUserLocation();

  // The map jumps to the user exactly once, on the first fix of a session.
  // After that the camera is theirs: re-centring under a pan is the single
  // most irritating thing a map can do.
  const hasCentredOnUser = useRef(false);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
    }
    settleTimer.current = setTimeout(() => {
      setViewport({
        bounds: regionToBounds(region),
        zoom: regionToZoom(region.longitudeDelta),
      });
    }, REGION_SETTLE_MS);
  }, []);

  const {data, isLoading, isError} = useQuery({
    queryKey: queryKeys.parcels.inBounds(viewport.bounds, viewport.zoom),
    queryFn: () => fetchParcelsInBounds(viewport.bounds, viewport.zoom),
    // doc 05 §3 caches these 30 s at the edge; matching it here means a pan back
    // to where the user just was is instant and costs nothing.
    staleTime: 30_000,
    // FR-54 wants other players' claims to appear within 60 s.
    refetchInterval: 60_000,
    placeholderData: previous => previous,
  });

  const parcels: ParcelFeature[] = useMemo(() => {
    if (data?.mode !== 'geometry') {
      return [];
    }
    return showOnlyMine ? data.parcels.filter(parcel => parcel.isMine) : data.parcels;
  }, [data, showOnlyMine]);

  const centreOn = useCallback(
    (fix: LatLng) => {
      mapRef.current?.animateToRegion(
        {
          latitude: fix.lat,
          longitude: fix.lng,
          // Tighter than the launch region: once we know where the user is,
          // street level is the useful zoom, not city level.
          latitudeDelta: REGION_DELTA.street,
          longitudeDelta: REGION_DELTA.street,
        },
        theme.durations.normal,
      );
    },
    [theme.durations.normal],
  );

  // The first fix of the session centres the map. `location.position` only
  // changes when a fix actually lands, so this cannot fire on a re-render.
  useEffect(() => {
    if (location.position && !hasCentredOnUser.current) {
      hasCentredOnUser.current = true;
      centreOn(location.position);
    }
  }, [centreOn, location.position]);

  const startWalk = useCallback(() => {
    // Straight to the walk when the grant is already in hand. Routing through
    // the rationale unconditionally is what made the app look like it was
    // asking for location before every single walk — the disclosure exists to
    // precede the system dialog (doc 06 §5), and there is no dialog left once
    // permission has been granted.
    if (location.availability === 'granted') {
      navigation.navigate('ActiveWalk');
      return;
    }
    // 'checking' lands here too, and the rationale screen short-circuits itself
    // once its own check resolves.
    navigation.navigate('LocationRationale', {returnTo: 'ActiveWalk'});
  }, [location.availability, navigation]);

  const recentre = useCallback(() => {
    // No permission yet — the FR-10 rationale is the only legitimate route to
    // the system dialog (doc 06 §5), so send the user there rather than
    // silently doing nothing.
    if (location.availability === 'needs-permission' || location.availability === 'blocked') {
      navigation.navigate('LocationRationale', {});
      return;
    }

    void location.locate().then(fix => {
      if (fix) {
        centreOn(fix);
      }
    });
  }, [centreOn, location, navigation]);

  return (
    <Screen edges={[]} bleed>
      <MapView
        ref={mapRef}
        // Google Maps on BOTH platforms, so a parcel looks the same everywhere.
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
        // Only once the runtime grant is in hand. Setting it unconditionally is
        // a silent no-op on Android without ACCESS_FINE_LOCATION, which reads
        // to the user as "the app can't find me".
        showsUserLocation={location.availability === 'granted'}
        // Our own control replaces it, so the button matches the rest of the
        // chrome and can route to the rationale when permission is missing.
        showsMyLocationButton={false}
        // The default POI layer competes with the parcels for attention, and
        // the parcels are the product.
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}>
        {parcels.map(parcel => (
          <MapPolygon
            key={parcel.id}
            coordinates={parcel.polygon.outer.map(toLatLng)}
            holes={parcel.polygon.holes?.map(hole => hole.map(toLatLng))}
            fillColor={withAlpha(parcel.colorHex, parcel.isMine ? 0.45 : 0.28)}
            strokeColor={isProtected(parcel) ? theme.colors.protectedStroke : parcel.colorHex}
            // FR-41: protected parcels are visually marked, so a player can see
            // before planning a route that walking it would be wasted.
            strokeWidth={isProtected(parcel) ? 3 : 1.5}
            tappable
            onPress={() => navigation.navigate('ParcelDetail', {parcelId: parcel.id})}
          />
        ))}
      </MapView>

      <View style={[styles.topBar, {top: insets.top + theme.spacing.sm}]} pointerEvents="box-none">
        {data?.mode === 'aggregate' ? (
          <View style={styles.banner}>
            <Text variant="caption" color="textSecondary">
              {t('map.zoomInForParcels')}
            </Text>
          </View>
        ) : null}

        {isError ? (
          <View style={styles.banner}>
            <Text variant="caption" color="danger">
              {t('map.loadFailed')}
            </Text>
          </View>
        ) : null}

        {/*
          Without this the map is simply blank where the user expects to be,
          with nothing saying why. Tapping routes to the FR-10 rationale, which
          is the only screen allowed to raise the system dialog (doc 06 §5).
        */}
        {location.availability === 'needs-permission' ||
        location.availability === 'blocked' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.locationOff')}
            accessibilityHint={t('map.locationOffHint')}
            onPress={() => navigation.navigate('LocationRationale', {})}
            style={[styles.banner, styles.bannerRow]}>
            <Icon name="alert" size={16} color="warning" />
            <Text variant="caption" color="textSecondary">
              {t('map.locationOff')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/*
        Controls and the start button share ONE bottom-anchored column.
        They used to be two absolutely-positioned siblings with hand-computed
        offsets, which put the round controls underneath the start button — and
        would have broken again at any other button height, which NFR-10's 200%
        font scaling guarantees will happen.
      */}
      <View
        style={[styles.bottomDock, {paddingBottom: insets.bottom + theme.spacing.md}]}
        pointerEvents="box-none">
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showOnlyMine ? t('map.showEveryone') : t('map.showOnlyMine')}
            accessibilityState={{selected: showOnlyMine}}
            onPress={() => setShowOnlyMine(current => !current)}
            style={styles.controlButton}>
            <Icon name="layers" size={22} color={showOnlyMine ? 'accent' : 'textSecondary'} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.recenter')}
            accessibilityState={{busy: location.isLocating}}
            onPress={recentre}
            style={styles.controlButton}>
            <Icon
              name="crosshair"
              size={22}
              // Dimmed while there is no permission, so the control reads as
              // "not ready" rather than broken when it opens the rationale.
              color={location.availability === 'granted' ? 'textSecondary' : 'textTertiary'}
            />
          </Pressable>
        </View>

        <Button
          label={t('walk.start')}
          icon={<Icon name="walk" size={20} color="onAccent" />}
          loading={isLoading && parcels.length === 0}
          onPress={startWalk}
        />
      </View>
    </Screen>
  );
}

function toLatLng({lat, lng}: {lat: number; lng: number}) {
  return {latitude: lat, longitude: lng};
}

function isProtected(parcel: ParcelFeature): boolean {
  return parcel.protectedUntil !== null && new Date(parcel.protectedUntil) > new Date();
}

/**
 * Applies alpha to a `#RRGGBB` colour.
 *
 * react-native-maps needs an actual colour value for `fillColor`, and the
 * owner's colour arrives as a hex string from the server. An invalid value
 * falls back to transparent rather than throwing — a malformed colour must not
 * take the map down.
 */
/* eslint-disable no-bitwise -- unpacking a packed 24-bit colour */
function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    return 'rgba(156, 163, 175, 0.25)';
  }
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
/* eslint-enable no-bitwise */

const useStyles = makeStyles(theme => ({
  map: {
    ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
  },
  topBar: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  banner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  bannerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    minHeight: theme.layout.minTouchTarget,
  },
  bottomDock: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: 0,
    gap: theme.spacing.md,
  },
  controls: {
    // Right-aligned above the full-width start button, so the column reads as
    // one stack rather than two things that happen to be near each other.
    alignSelf: 'flex-end',
    gap: theme.spacing.sm,
  },
  controlButton: {
    minHeight: theme.layout.minTouchTarget,
    minWidth: theme.layout.minTouchTarget,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
