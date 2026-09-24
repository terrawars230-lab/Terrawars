import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Alert, Platform, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import MapView, {
  Marker,
  Polygon as MapPolygon,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Icon, Loader, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {LAUNCH_CITY, REGION_DELTA} from '@core/constants/mapDefaults';
import {createLogger} from '@core/logger/logger';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import {formatArea, formatDistance, formatDuration, formatPace} from '@core/utils/format';
import type {RootStackParamList} from '@navigation/types';
import {openAppSettings} from '@services/permissions/permissions';

import {useWalkSession} from '../hooks/useWalkSession';
import {
  discardCurrentWalk,
  finishCurrentWalk,
  onWalkRecorderEvent,
  pauseWalk,
  resumeWalk,
} from '../services/walkRecorder';
import {useWalkStore} from '../store/walkStore';

const logger = createLogger('walk-screen');

/** The weak-GPS hint lingers this long past the last bad fix, so it does not blink. */
const WEAK_GPS_HINT_MS = 20_000;

/**
 * The live walk screen (FR-13, FR-14, FR-16, FR-17, FR-18).
 *
 * Shows the trail as it is drawn, the running metrics, and — the moment GR-02
 * reports a closed loop — the claim prompt with the enclosed polygon
 * highlighted.
 *
 * Everything shown here is advisory. The polygon is a preview, the area is an
 * estimate, and neither is what the user will be awarded; the server decides
 * (D-05). The copy is deliberately worded so the number never reads as a
 * promise.
 *
 * Recording does not depend on this screen being mounted (see
 * services/walkRecorder). Leaving it to look at the map keeps the walk going,
 * and the map's walk button brings the user back.
 */
export function ActiveWalkScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const session = useWalkSession();

  // FR-15: "On relaunch the user is offered to resume or discard the
  // interrupted walk." The walk is already on disk; this is the offer.
  if (session.state.status === 'recovery-offer') {
    return (
      <Screen>
        <View style={styles.gate}>
          <Text variant="title1">{t('walk.resumeTitle')}</Text>
          <Text variant="body" color="textSecondary">
            {t('walk.resumeBody', {
              time: new Date(session.state.startedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </Text>
          <View style={styles.gateActions}>
            <Button label={t('walk.resumeConfirm')} onPress={session.resumeInterrupted} />
            <Button
              label={t('walk.resumeDiscard')}
              variant="ghost"
              onPress={() => {
                void session.discardAndStartFresh();
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (session.state.status === 'failed') {
    return <StartFailed error={session.state.error} onRetry={session.retry} />;
  }

  if (session.state.status === 'checking' || session.state.status === 'starting') {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    );
  }

  return <WalkInProgress />;
}

function StartFailed({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();

  // Say why when we know: "no connection" and "location is off" have different
  // fixes, and a bare "something went wrong" offers neither.
  const message = ApiError.isApiError(error)
    ? t(errorMessageKey(error.code))
    : t('walk.startFailedBody');

  return (
    <Screen>
      <View style={styles.gate}>
        <Text variant="title2">{t('walk.startFailedTitle')}</Text>
        <Text variant="body" color="textSecondary">
          {message}
        </Text>
        <View style={styles.gateActions}>
          <Button
            label={t('common.retry')}
            onPress={() => {
              void onRetry();
            }}
          />
          <Button label={t('common.back')} variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </Screen>
  );
}

function WalkInProgress(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // Typed as the stack's own prop, not the generic NavigationProp: `replace`
  // only exists on a stack navigator, and this also keeps route params checked.
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const phase = useWalkStore(state => state.phase);
  const distanceM = useWalkStore(state => state.distanceM);
  const preview = useWalkStore(state => state.preview);
  const canClaim = useWalkStore(state => state.canClaim);
  const path = useWalkStore(state => state.samples);
  const autoEndReason = useWalkStore(state => state.autoEndReason);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  /** Timestamp of the last degraded-accuracy report, for the weak-GPS hint. */
  const [weakGpsAt, setWeakGpsAt] = useState<number | null>(null);

  const mapRef = useRef<MapView>(null);
  /** Cleared the first time the user pans, which hands the camera back. */
  const isFollowing = useRef(true);
  /** The first fix sets the zoom; every fix after it only pans. */
  const hasFramedFirstFix = useRef(false);

  // ── Map geometry, memoised ─────────────────────────────────────────────
  //
  // Rebuilt only when a sample actually lands. Mapping thousands of points on
  // every render — and the HUD clock used to re-render this whole screen once
  // a second — re-sent the full polyline across the bridge each time, which is
  // the NFR-03 frame budget spent on nothing.
  const trail = useMemo(
    () => path.map(({lat, lng}) => ({latitude: lat, longitude: lng})),
    [path],
  );
  const previewRing = useMemo(
    () =>
      preview && preview.ring.length >= 3
        ? preview.ring.map(({lat, lng}) => ({latitude: lat, longitude: lng}))
        : null,
    [preview],
  );

  // Mounting without an initialRegion drops the map at the library default,
  // which is the entire globe. A resumed walk (FR-15) already knows where it
  // was; a fresh one holds the launch city until the first fix reframes it.
  // Frozen at mount: a changing initialRegion is ignored anyway.
  const initialRegion = useRef<Region>({
    latitude: path[0]?.lat ?? LAUNCH_CITY.latitude,
    longitude: path[0]?.lng ?? LAUNCH_CITY.longitude,
    latitudeDelta: REGION_DELTA.street,
    longitudeDelta: REGION_DELTA.street,
  }).current;

  // ── Follow the user with the camera ────────────────────────────────────
  //
  // `followsUserLocation` cannot do this: react-native-maps supports it on
  // Apple Maps only, and this app is on Google Maps on both platforms, so on
  // Android the map simply never moved. Following the newest sample is the
  // equivalent that actually works on both.
  const latest = path[path.length - 1];
  useEffect(() => {
    if (!latest || !isFollowing.current) {
      return;
    }

    const centre = {latitude: latest.lat, longitude: latest.lng};

    if (!hasFramedFirstFix.current) {
      hasFramedFirstFix.current = true;
      // `animateToRegion`, not `animateCamera`: a Region carries the span, and
      // the span IS the zoom.
      mapRef.current?.animateToRegion(
        {...centre, latitudeDelta: REGION_DELTA.street, longitudeDelta: REGION_DELTA.street},
        theme.durations.normal,
      );
      return;
    }

    // After the first frame the zoom is the user's to set — pinch it and it
    // stays pinched. This only keeps them centred.
    mapRef.current?.animateCamera({center: centre}, {duration: 500});
  }, [latest, theme.durations.normal]);

  // ── Finishing ──────────────────────────────────────────────────────────
  const isFinishing = useRef(false);

  const handleFinish = useCallback(async () => {
    if (isFinishing.current) {
      return;
    }
    isFinishing.current = true;
    setIsSubmitting(true);

    try {
      const outcome = await finishCurrentWalk().finally(() => {
        // Lowered BEFORE navigating: the beforeRemove guard below would
        // otherwise block the very replace/goBack that leaves this screen.
        isFinishing.current = false;
      });

      if (outcome.kind === 'queued') {
        // FR-20: recorded offline. The exercise is saved and the claim will go
        // up on its own.
        Alert.alert(t('walk.queuedOfflineTitle'), t('walk.queuedOffline'));
        navigation.goBack();
        return;
      }

      const {result} = outcome;
      navigation.replace('ClaimResult', {
        claimId: result.claimId || null,
        summary: {
          status: result.status,
          errorCode: result.status === 'rejected' ? result.errorCode : null,
          netAreaGainM2: result.status === 'accepted' ? result.netAreaGainM2 : 0,
          stolenAreaM2: result.status === 'accepted' ? result.stolenAreaM2 : 0,
          distanceM: result.walk.distanceM,
          durationS: result.walk.durationS,
        },
      });
    } catch (error) {
      logger.error('Could not finish the walk', error);
      Alert.alert(
        t('walk.finishFailedTitle'),
        ApiError.isApiError(error) ? t(errorMessageKey(error.code)) : t('errors.UNKNOWN'),
      );
      // The store has been reset for a final failure; there is no walk left to
      // show, so go back to the map rather than render an empty HUD.
      if (useWalkStore.getState().phase === 'idle') {
        navigation.goBack();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [navigation, t]);

  // FR-19: the walk auto-ends past four hours or 25 km. The recorder stops it
  // wherever the user is; this finishes it the moment the screen is in front
  // of them, and says why, so it never looks like a crash.
  const autoEndHandled = useRef(false);
  useEffect(() => {
    if (!autoEndReason || autoEndHandled.current) {
      return;
    }
    autoEndHandled.current = true;

    const distanceLimit = formatDistance(WALK_LIMITS.maxDistanceM);
    const durationLimit = formatDuration(WALK_LIMITS.maxDurationMs / 1000);
    Alert.alert(
      t(autoEndReason === 'distance' ? 'walk.autoEndedDistance' : 'walk.autoEndedDuration', {
        distance: t(distanceLimit.i18nKey, {value: distanceLimit.value}),
        duration: t(durationLimit.i18nKey, durationLimit.params),
      }),
    );
    void handleFinish();
  }, [autoEndReason, handleFinish, t]);

  // ── Recorder events ────────────────────────────────────────────────────
  useEffect(
    () =>
      onWalkRecorderEvent(event => {
        if (event.type === 'accuracyDegraded') {
          setWeakGpsAt(Date.now());
          return;
        }
        if (event.type !== 'trackerStopped' || event.reason === 'user') {
          return;
        }

        if (event.reason === 'permission-revoked') {
          Alert.alert(t('walk.permissionLostTitle'), t('walk.permissionLostBody'), [
            {text: t('common.close'), style: 'cancel'},
            {
              text: t('permissions.locationOpenSettings'),
              onPress: () => {
                void openAppSettings();
              },
            },
          ]);
          return;
        }

        // doc 06 §8.2: the OEM battery killer. The walk is paused and safe;
        // tell the user, and on Android point them at the setting that stops
        // it happening again.
        Alert.alert(t('walk.trackingStoppedTitle'), t('walk.trackingStoppedBody'), [
          {text: t('common.close'), style: 'cancel'},
          ...(Platform.OS === 'android'
            ? [
                {
                  text: t('battery.openGuide'),
                  onPress: () => navigation.navigate('BatteryGuidance'),
                },
              ]
            : []),
        ]);
      }),
    [navigation, t],
  );

  // A claim being submitted must not be abandoned half-way by a back gesture;
  // the result screen replaces this one when it lands.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        if (isFinishing.current) {
          event.preventDefault();
        }
      }),
    [navigation],
  );

  const handleDiscard = useCallback(() => {
    Alert.alert(t('walk.discardConfirmTitle'), t('walk.discardConfirmBody'), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('walk.discard'),
        style: 'destructive',
        onPress: () => {
          void discardCurrentWalk().finally(() => navigation.goBack());
        },
      },
    ]);
  }, [navigation, t]);

  const handlePauseResume = useCallback(async () => {
    if (phase !== 'paused') {
      await pauseWalk();
      return;
    }

    setIsResuming(true);
    try {
      await resumeWalk();
    } catch (error) {
      logger.error('Could not resume the walk', error);
      Alert.alert(t('walk.resumeFailedTitle'), t('walk.resumeFailedBody'), [
        {text: t('common.close'), style: 'cancel'},
        {
          text: t('permissions.locationOpenSettings'),
          onPress: () => {
            void openAppSettings();
          },
        },
      ]);
    } finally {
      setIsResuming(false);
    }
  }, [phase, t]);

  const distance = formatDistance(distanceM);
  const enclosed = preview && preview.areaM2 > 0 ? formatArea(preview.areaM2) : null;
  const enclosedLabel = enclosed ? t(enclosed.i18nKey, {value: enclosed.value}) : null;

  // No fix yet. Worth saying out loud: an empty map and a 0 m readout look
  // identical to a broken app, and the first fix can take 30 s from cold.
  const isWaitingForFirstFix = path.length === 0 && phase === 'recording';
  const isGpsWeak = weakGpsAt !== null && Date.now() - weakGpsAt < WEAK_GPS_HINT_MS;
  const isEnded = autoEndReason !== null || phase === 'finishing';

  return (
    <Screen edges={[]} bleed>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        // Every route to this screen checks the grant first, so it is in hand.
        showsUserLocation
        // NOT followsUserLocation — that is Apple Maps only. The camera is
        // driven from the sample stream in the effect above.
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        // Panning is a deliberate "let me look somewhere else", so it stops the
        // camera fighting the user for the rest of the walk.
        onPanDrag={() => {
          isFollowing.current = false;
        }}>
        {/* FR-13: the live trail. */}
        <Polyline
          coordinates={trail}
          strokeColor={theme.colors.trail}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />

        {/*
          The head of the trail: the last point actually recorded, as opposed to
          the platform's raw blue dot. tracksViewChanges={false} is not
          optional — it moves on every sample, and re-rasterising a custom
          marker view each time is the classic react-native-maps frame drop.
        */}
        {latest ? (
          <Marker
            coordinate={{latitude: latest.lat, longitude: latest.lng}}
            anchor={{x: 0.5, y: 0.5}}
            flat
            tracksViewChanges={false}
            accessibilityLabel={t('walk.yourPosition')}>
            <View style={styles.pointerRing}>
              <View style={styles.pointerCore} />
            </View>
          </Marker>
        ) : null}

        {/* FR-18: the advisory polygon, once a loop has closed. */}
        {previewRing ? (
          <MapPolygon
            coordinates={previewRing}
            fillColor={theme.colors.previewFill}
            strokeColor={theme.colors.previewStroke}
            strokeWidth={2}
          />
        ) : null}
      </MapView>

      <View style={[styles.hud, {paddingBottom: insets.bottom + theme.spacing.lg}]}>
        <View style={styles.metrics}>
          <Metric label={t('walk.distance')} value={t(distance.i18nKey, {value: distance.value})} />
          <ClockMetrics />
          <Metric
            label={t('walk.enclosedArea')}
            value={enclosedLabel ?? '—'}
            highlighted={canClaim}
          />
        </View>

        {phase === 'paused' && !isEnded ? (
          <Text variant="caption" color="textSecondary" align="center">
            {t('walk.pausedHint')}
          </Text>
        ) : isWaitingForFirstFix ? (
          <View style={styles.status} accessibilityRole="alert">
            <Icon name="crosshair" size={16} color="textSecondary" />
            <Text variant="caption" color="textSecondary" align="center">
              {t('walk.waitingForGps')}
            </Text>
          </View>
        ) : isGpsWeak ? (
          <View style={styles.status} accessibilityRole="alert">
            <Icon name="alert" size={16} color="warning" />
            <Text variant="caption" color="warning" align="center">
              {t('walk.gpsWeak')}
            </Text>
          </View>
        ) : canClaim ? (
          <Text variant="caption" color="accent" align="center">
            {t('walk.loopReadyBody', {area: enclosedLabel ?? ''})}
          </Text>
        ) : (
          <Text variant="caption" color="textSecondary" align="center">
            {t('walk.keepWalkingHint')}
          </Text>
        )}

        <View style={styles.actions}>
          <Button
            label={phase === 'paused' ? t('walk.resume') : t('walk.pause')}
            variant="secondary"
            size="medium"
            fullWidth={false}
            style={styles.actionButton}
            loading={isResuming}
            disabled={isEnded || isSubmitting}
            icon={
              <Icon name={phase === 'paused' ? 'play' : 'pause'} size={18} color="textPrimary" />
            }
            onPress={() => {
              void handlePauseResume();
            }}
          />
          <Button
            label={canClaim ? t('walk.loopReadyConfirm') : t('walk.finish')}
            size="medium"
            fullWidth={false}
            style={styles.actionButton}
            icon={<Icon name="flag" size={18} color="accent" />}
            loading={isSubmitting}
            onPress={() => {
              void handleFinish();
            }}
          />
        </View>

        <Button
          label={t('walk.discard')}
          variant="ghost"
          size="medium"
          disabled={isSubmitting}
          icon={<Icon name="trash" size={16} color="accent" />}
          onPress={handleDiscard}
        />
      </View>
    </Screen>
  );
}

/**
 * Duration and pace, on their own one-second clock.
 *
 * Isolated so the tick re-renders these two readouts and nothing else. When
 * the clock lived in the screen, every second re-rendered the map, the trail
 * and the preview polygon along with it.
 */
function ClockMetrics(): React.JSX.Element {
  const {t} = useTranslation();
  const [clock, setClock] = useState(() => readClock());

  useEffect(() => {
    const interval = setInterval(() => setClock(readClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  const duration = formatDuration(clock.elapsedS);
  // The rolling window, not distance/elapsed. A whole-walk average counts the
  // minute spent waiting for the first fix as walking.
  const pace = formatPace(clock.speedMps);

  return (
    <>
      <Metric label={t('walk.duration')} value={t(duration.i18nKey, duration.params)} />
      <Metric label={t('walk.pace')} value={pace ? t('units.paceMinPerKm', {value: pace}) : '—'} />
    </>
  );
}

function readClock(): {elapsedS: number; speedMps: number} {
  const store = useWalkStore.getState();
  return {elapsedS: store.elapsedSeconds(), speedMps: store.recentSpeedMps()};
}

function Metric({
  label,
  value,
  highlighted = false,
}: {
  label: string;
  value: string;
  highlighted?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="metricLabel" color="textTertiary">
        {label}
      </Text>
      <Text variant="metric" color={highlighted ? 'accent' : 'textPrimary'}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  map: {
    ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
  },
  hud: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
    ...theme.shadows.lg,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.md,
  },
  metric: {
    // Two per row at default text size, one per row at 200% scaling — NFR-10
    // wants the layout to flex rather than the text to be capped.
    minWidth: '45%',
    gap: theme.spacing.xxs,
  },
  pointerRing: {
    width: 26,
    height: 26,
    borderRadius: theme.radius.pill,
    // A translucent halo so the marker stays findable over dark map tiles and
    // over the trail's own colour.
    backgroundColor: theme.colors.previewFill,
    borderWidth: 2,
    borderColor: theme.colors.trail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerCore: {
    width: 12,
    height: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.trail,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
  },
  gateActions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
}));
