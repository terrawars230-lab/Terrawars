import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Pressable, View} from 'react-native';

import {useIsFocused, useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import MapView, {PROVIDER_GOOGLE, type Region} from 'react-native-maps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Icon, Screen, Text} from '@components/index';
import {LAUNCH_CITY, REGION_DELTA} from '@core/constants/mapDefaults';
import {queryKeys} from '@core/constants/queryKeys';
import {isDefinitelyOffline, useNetworkStatus} from '@core/hooks/useNetworkStatus';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import type {LatLng, MapBounds} from '@core/types/geo';
import {withAlpha} from '@core/utils/color';
import {formatArea, formatDistance} from '@core/utils/format';
import {fetchMyProfile} from '@features/profile/api/profileApi';
import {hasInterruptedWalk, useStartWalk} from '@features/walk/hooks/useStartWalk';
import {useWalkStore} from '@features/walk/store/walkStore';

import {fetchParcelsInBounds, type ParcelFeature} from '../api/mapApi';
import {IdentityPill} from '../components/IdentityPill';
import {MapControlButton} from '../components/MapControlButton';
import {ParcelPolygon, type ParcelPolygonProps} from '../components/ParcelPolygon';
import {RaidTargetCard} from '../components/RaidTargetCard';
import {StartWalkButton} from '../components/StartWalkButton';
import {WeeklyContractCard} from '../components/WeeklyContractCard';
import {useUserLocation} from '../hooks/useUserLocation';
import {useWeeklyContract} from '../hooks/useWeeklyContract';
import {NOCTURNE_MAP_STYLE} from '../mapStyle';
import {isParcelProtected, pickRaidTarget} from '../utils/raidTarget';
import {regionToBounds, regionToZoom} from '../utils/viewport';

/**
 * The world map (FR-50 … FR-54). The app's home surface.
 *
 * Performance is a stated requirement here, not an aspiration: NFR-03 asks for
 * 45 fps while panning with 500 parcels in the viewport, and NFR-04 gives the
 * viewport query a 400 ms p95. What does the work:
 *
 *  - the server simplifies geometry by zoom (doc 04 §4), so the client never
 *    receives more vertices than the screen can resolve;
 *  - the region is debounced before it becomes a query, so a pan fires one
 *    request rather than sixty;
 *  - `queryKeys.parcels.inBounds` rounds the bbox, so small pans hit the cache;
 *  - each parcel's native props are built once per fetch and the polygons are
 *    memoised, so an unrelated re-render sends nothing to the map;
 *  - polling stops whenever the map is not the screen in front of the user.
 */

/** Lahore — the OQ-3 launch city. Used until the first location fix arrives. */
const INITIAL_REGION: Region = {
  ...LAUNCH_CITY,
  latitudeDelta: REGION_DELTA.city,
  longitudeDelta: REGION_DELTA.city,
};

/** How long the map must be still before the viewport becomes a query. */
const REGION_SETTLE_MS = 400;

/** FR-54: other players' claims appear within 60 s. */
const PARCEL_POLL_MS = 60_000;

type PolygonRenderProps = Omit<ParcelPolygonProps, 'onPressParcel'>;

export function MapScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const network = useNetworkStatus();
  const startWalk = useStartWalk();

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
  const canShowPosition =
    location.availability === 'granted' || location.availability === 'approximate';

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

  // A pending settle must not fire into an unmounted screen.
  useEffect(
    () => () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    },
    [],
  );

  const {data, isLoading, isError} = useQuery({
    queryKey: queryKeys.parcels.inBounds(viewport.bounds, viewport.zoom),
    queryFn: () => fetchParcelsInBounds(viewport.bounds, viewport.zoom),
    // doc 05 §3 caches these 30 s at the edge; matching it here means a pan back
    // to where the user just was is instant and costs nothing.
    staleTime: 30_000,
    // Only while the map is actually on screen. Under an active walk, a pushed
    // screen or another tab, polling a map nobody is looking at is the NFR-01
    // battery budget spent on nothing.
    refetchInterval: isFocused ? PARCEL_POLL_MS : false,
    placeholderData: previous => previous,
  });

  // Already in cache from the navigator's username gate, so the HUD paints on
  // the first frame rather than popping in.
  const {data: profile} = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  const contract = useWeeklyContract(profile !== undefined);

  const allParcels: ParcelFeature[] = useMemo(
    () => (data?.mode === 'geometry' ? data.parcels : []),
    [data],
  );

  // Native props, built once per fetch rather than once per render.
  const polygons: PolygonRenderProps[] = useMemo(
    () =>
      allParcels
        .filter(parcel => !showOnlyMine || parcel.isMine)
        .map(parcel => {
          const isProtected = isParcelProtected(parcel);
          return {
            id: parcel.id,
            coordinates: parcel.polygon.outer.map(toMapLatLng),
            holes: parcel.polygon.holes?.map(hole => hole.map(toMapLatLng)),
            fillColor: withAlpha(parcel.colorHex, parcel.isMine ? 0.45 : 0.28),
            // FR-41: protected parcels are visually marked, so a player can see
            // before planning a route that walking it would be wasted.
            strokeColor: isProtected ? theme.colors.protectedStroke : parcel.colorHex,
            strokeWidth: isProtected ? 2.5 : 1.5,
          };
        }),
    [allParcels, showOnlyMine, theme.colors.protectedStroke],
  );

  const openParcel = useCallback(
    (parcelId: string) => navigation.navigate('ParcelDetail', {parcelId}),
    [navigation],
  );

  // Picked from everything in the viewport, not the filtered set: turning on
  // "my land only" is a question about the map, not about who to raid next.
  const raidTarget = useMemo(
    () => pickRaidTarget(allParcels, location.position),
    [allParcels, location.position],
  );

  const centreOn = useCallback(
    (fix: LatLng) => {
      mapRef.current?.animateToRegion(
        {
          latitude: fix.lat,
          longitude: fix.lng,
          // Once we know where the user is, street level is the useful zoom.
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

  const recentre = useCallback(() => {
    // No permission yet — the FR-10 rationale is the only legitimate route to
    // the system dialog (doc 06 §5), so send the user there rather than
    // silently doing nothing.
    if (!canShowPosition) {
      navigation.navigate('LocationRationale', {});
      return;
    }

    void location.locate().then(fix => {
      if (fix) {
        centreOn(fix);
      }
    });
  }, [canShowPosition, centreOn, location, navigation]);

  // The walk keeps recording while the player looks at the map, so the one
  // primary button says so and leads back to it, rather than offering to start
  // a second walk on top of the first.
  const walkPhase = useWalkStore(state => state.phase);
  const walkButtonLabel =
    walkPhase !== 'idle'
      ? t('walk.returnToWalk')
      : isFocused && hasInterruptedWalk()
      ? t('walk.resumeUnfinished')
      : t('walk.start');

  const heldArea = formatArea(profile?.stats.totalAreaM2 ?? 0);
  const gained = formatArea(contract.gainedM2);
  const goal = formatArea(contract.targetM2);
  const contractLabel = t('map.contractProgress', {
    gained: t(gained.i18nKey, {value: gained.value}),
    goal: t(goal.i18nKey, {value: goal.value}),
  });

  return (
    <Screen edges={[]} bleed>
      <MapView
        ref={mapRef}
        // Google Maps on BOTH platforms, so a parcel looks the same everywhere.
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        // The design is drawn over dark tiles; the default light basemap turns
        // every parcel fill into a pastel wash (see mapStyle.ts).
        customMapStyle={NOCTURNE_MAP_STYLE}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
        // Only once a runtime grant is in hand. Setting it unconditionally is
        // a silent no-op on Android without the permission, which reads to the
        // user as "the app can't find me".
        showsUserLocation={canShowPosition}
        // Our own control replaces it, so the button matches the rest of the
        // chrome and can route to the rationale when permission is missing.
        showsMyLocationButton={false}
        // The default POI layer competes with the parcels for attention, and
        // the parcels are the product.
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}>
        {polygons.map(polygon => (
          <ParcelPolygon key={polygon.id} {...polygon} onPressParcel={openParcel} />
        ))}
      </MapView>

      <View
        style={[styles.topHud, {top: insets.top + theme.spacing.sm}]}
        pointerEvents="box-none">
        {profile ? (
          <View style={styles.identityRow} pointerEvents="box-none">
            <IdentityPill
              username={profile.username}
              avatarUrl={profile.avatarUrl}
              colorHex={profile.colorHex}
              subtitle={t('map.heldAndRank', {
                area: t(heldArea.i18nKey, {value: heldArea.value}),
                rank: profile.stats.rankGlobal,
              })}
            />
          </View>
        ) : null}

        <WeeklyContractCard
          title={t('map.weeklyContract')}
          progressLabel={contractLabel}
          progress={contract.progress}
          accessibilityLabel={t('map.weeklyContractA11y', {progress: contractLabel})}
        />

        {isDefinitelyOffline(network) ? (
          <View style={styles.banner} accessibilityRole="alert">
            <Text variant="caption" color="warning">
              {t('map.offline')}
            </Text>
          </View>
        ) : isError ? (
          <View style={styles.banner}>
            <Text variant="caption" color="danger">
              {t('map.loadFailed')}
            </Text>
          </View>
        ) : null}

        {data?.mode === 'aggregate' ? (
          <View style={styles.banner}>
            <Text variant="caption" color="textSecondary">
              {t('map.zoomInForParcels')}
            </Text>
          </View>
        ) : null}

        {/*
          Without this the map is simply blank where the user expects to be,
          with nothing saying why. Tapping routes to the FR-10 rationale, which
          is the only screen allowed to raise the system dialog (doc 06 §5).
        */}
        {location.availability === 'needs-permission' ||
        location.availability === 'blocked' ||
        location.availability === 'approximate' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              location.availability === 'approximate' ? t('map.locationApproximate') : t('map.locationOff')
            }
            accessibilityHint={t('map.locationOffHint')}
            onPress={() => navigation.navigate('LocationRationale', {})}
            style={({pressed}) => [
              styles.banner,
              styles.bannerRow,
              pressed && styles.bannerPressed,
            ]}>
            <Icon name="alert" size={16} color="warning" />
            <Text variant="caption" color="textSecondary" style={styles.bannerText}>
              {location.availability === 'approximate'
                ? t('map.locationApproximate')
                : t('map.locationOff')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/*
        The rail, the raid card and the CTA share ONE bottom-anchored column, so
        200% font scaling (NFR-10) grows the stack instead of overlapping it.

        Two things from the design are deliberately absent: the rival "pings"
        (CLAUDE.md rule 6 forbids exposing another user's live position) and
        the streak chip (no field behind it anywhere in the schema).
      */}
      <View
        style={[styles.bottomDock, {paddingBottom: insets.bottom + theme.layout.hudInset}]}
        pointerEvents="box-none">
        <View style={styles.rail} pointerEvents="box-none">
          <View style={styles.railLabel}>
            <Text variant="tiny" color="textSecondary">
              {showOnlyMine ? t('map.showOnlyMine') : t('map.showEveryone')}
            </Text>
          </View>

          <MapControlButton
            icon="layers"
            label={showOnlyMine ? t('map.showEveryone') : t('map.showOnlyMine')}
            active={showOnlyMine}
            onPress={() => setShowOnlyMine(current => !current)}
          />

          <MapControlButton
            icon="crosshair"
            label={t('map.recenter')}
            busy={location.isLocating}
            // Dimmed while there is no permission, so the control reads as
            // "not ready" rather than broken when it opens the rationale.
            muted={!canShowPosition}
            onPress={recentre}
          />
        </View>

        {raidTarget && walkPhase === 'idle' ? (
          <RaidTargetCard
            title={t('map.raidTargetTitle', {username: raidTarget.parcel.ownerUsername})}
            detail={raidTargetDetail(t, raidTarget.parcel.areaM2, raidTarget.distanceM)}
            colorHex={raidTarget.parcel.colorHex}
            tagLabel={t('map.raid')}
            onPress={() => openParcel(raidTarget.parcel.id)}
          />
        ) : null}

        <StartWalkButton
          label={walkButtonLabel}
          loading={isLoading && polygons.length === 0 && walkPhase === 'idle'}
          onPress={startWalk}
        />
      </View>
    </Screen>
  );
}

function toMapLatLng({lat, lng}: {lat: number; lng: number}) {
  return {latitude: lat, longitude: lng};
}

/** "2,210 m² · 240 m from you", assembled through the localisation layer. */
function raidTargetDetail(
  t: (key: string, params?: Record<string, unknown>) => string,
  areaM2: number,
  distanceM: number,
): string {
  const area = formatArea(areaM2);
  const distance = formatDistance(distanceM);
  return t('map.raidTargetDetail', {
    area: t(area.i18nKey, {value: area.value}),
    distance: t(distance.i18nKey, {value: distance.value}),
  });
}

const useStyles = makeStyles(theme => ({
  map: {
    ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
  },
  topHud: {
    position: 'absolute',
    left: theme.layout.hudInset,
    right: theme.layout.hudInset,
    gap: theme.spacing.smd,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  banner: {
    backgroundColor: theme.colors.hudSurface,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
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
  bannerText: {
    flexShrink: 1,
  },
  bannerPressed: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  bottomDock: {
    position: 'absolute',
    left: theme.layout.hudInset,
    right: theme.layout.hudInset,
    bottom: 0,
    gap: theme.spacing.smd,
  },
  rail: {
    // Right-aligned above the full-width CTA, so the column reads as one stack
    // rather than three things that happen to be near each other.
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    gap: theme.spacing.smd,
  },
  railLabel: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.hudSurface,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
  },
}));
