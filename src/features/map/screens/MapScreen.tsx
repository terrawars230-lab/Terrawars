import React, {useCallback, useMemo, useRef, useState} from 'react';

import {Pressable, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import MapView, {Polygon as MapPolygon, PROVIDER_GOOGLE, type Region} from 'react-native-maps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Screen, Text} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import type {MapBounds} from '@core/types/geo';

import {fetchParcelsInBounds, type ParcelFeature} from '../api/mapApi';
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
  latitude: 31.5204,
  longitude: 74.3587,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
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

  const recentre = useCallback(() => {
    // TODO(Phase 2): use locationTracker.getCurrentPosition() once the
    // permission rationale flow is wired in front of it.
    mapRef.current?.animateToRegion(INITIAL_REGION, theme.durations.normal);
  }, [theme.durations.normal]);

  return (
    <Screen edges={[]} bleed>
      <MapView
        ref={mapRef}
        // Google Maps on BOTH platforms, so a parcel looks the same everywhere.
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation
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
      </View>

      <View
        style={[styles.controls, {bottom: insets.bottom + theme.spacing.xxxl}]}
        pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showOnlyMine ? t('map.showEveryone') : t('map.showOnlyMine')}
          accessibilityState={{selected: showOnlyMine}}
          onPress={() => setShowOnlyMine(current => !current)}
          style={styles.controlButton}>
          <Text variant="caption" color={showOnlyMine ? 'accent' : 'textSecondary'}>
            {showOnlyMine ? t('map.showEveryone') : t('map.showOnlyMine')}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.recenter')}
          onPress={recentre}
          style={styles.controlButton}>
          <Text variant="caption" color="textSecondary">
            {t('map.recenter')}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.startBar, {paddingBottom: insets.bottom + theme.spacing.md}]}>
        <Button
          label={t('walk.start')}
          loading={isLoading && parcels.length === 0}
          onPress={() => navigation.navigate('LocationRationale', {returnTo: 'ActiveWalk'})}
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
  controls: {
    position: 'absolute',
    right: theme.spacing.lg,
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
  startBar: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: 0,
  },
}));
