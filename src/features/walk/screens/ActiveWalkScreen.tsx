import React, {useCallback, useEffect, useRef, useState} from 'react';

import {Alert, View} from 'react-native';

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
import {LAUNCH_CITY, REGION_DELTA} from '@core/constants/mapDefaults';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import {formatArea, formatDistance, formatDuration, formatPace} from '@core/utils/format';
import type {RootStackParamList} from '@navigation/types';

import {useWalkRecorder} from '../hooks/useWalkRecorder';
import {useWalkSession} from '../hooks/useWalkSession';
import {useWalkStore} from '../store/walkStore';

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
 */
export function ActiveWalkScreen(): React.JSX.Element {
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

  const [elapsedS, setElapsedS] = useState(0);
  // Read off the store on the same tick as the clock rather than subscribed:
  // it is derived from a rolling window, so it changes on time, not on state.
  const [speedMps, setSpeedMps] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Timestamp of the last degraded-accuracy report, for the weak-GPS hint. */
  const [weakGpsAt, setWeakGpsAt] = useState<number | null>(null);

  const mapRef = useRef<MapView>(null);
  /** Cleared the first time the user pans, which hands the camera back. */
  const isFollowing = useRef(true);
  /** The first fix sets the zoom; every fix after it only pans. */
  const hasFramedFirstFix = useRef(false);

  const recorder = useWalkRecorder({
    onAccuracyDegraded: () => setWeakGpsAt(Date.now()),
    onAutoEnd: reason => {
      // FR-19: the walk auto-ends past four hours or 25 km. Told plainly rather
      // than silently, so it never looks like a crash.
      Alert.alert(
        t(reason === 'distance' ? 'walk.autoEndedDistance' : 'walk.autoEndedDuration', {
          distance: '25 km',
          duration: '4h',
        }),
      );
      void handleFinish();
    },
  });

  // Starts the walk on mount, or offers to resume an interrupted one (FR-15).
  // Nothing else calls recorder.start() — this hook owns that decision.
  const session = useWalkSession(recorder.start);

  // The clock ticks locally rather than from a store subscription: elapsed time
  // changes every second whether or not a GPS sample arrived, and re-rendering
  // the whole map polyline once a second would cost the NFR-03 frame budget.
  useEffect(() => {
    const interval = setInterval(() => {
      const store = useWalkStore.getState();
      setElapsedS(store.elapsedSeconds());
      setSpeedMps(store.recentSpeedMps());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Follow the user with the camera.
  //
  // `followsUserLocation` cannot do this: react-native-maps supports it on
  // Apple Maps only, and this app is on Google Maps on both platforms (per the
  // stack decision), so on Android the map simply never moved. Following the
  // newest sample is the equivalent that actually works on both.
  const latest = path[path.length - 1];
  useEffect(() => {
    if (!latest || !isFollowing.current) {
      return;
    }

    const centre = {latitude: latest.lat, longitude: latest.lng};

    if (!hasFramedFirstFix.current) {
      hasFramedFirstFix.current = true;
      // `animateToRegion`, not `animateCamera`: a Region carries the span, and
      // the span IS the zoom. Panning with animateCamera alone left the map at
      // whatever zoom it mounted with — which, with no initialRegion, was the
      // whole globe. That is why starting a walk looked like it zoomed out.
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

  const handleFinish = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const result = await recorder.finish();

      if (result === 'queued') {
        // FR-20: recorded offline. The exercise is saved and the claim will go
        // up on its own.
        Alert.alert(t('walk.queuedOffline'));
        navigation.goBack();
        return;
      }

      navigation.replace('ClaimResult', {claimId: result.claimId ?? ''});
    } finally {
      setIsSubmitting(false);
    }
  }, [navigation, recorder, t]);

  const handleDiscard = useCallback(() => {
    Alert.alert(t('walk.discardConfirmTitle'), t('walk.discardConfirmBody'), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('walk.discard'),
        style: 'destructive',
        onPress: () => {
          void recorder.discard().then(() => navigation.goBack());
        },
      },
    ]);
  }, [navigation, recorder, t]);

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
            <Button
              label={t('walk.resumeConfirm')}
              onPress={() => {
                void session.resumeInterrupted();
              }}
            />
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
    return (
      <Screen>
        <View style={styles.gate}>
          <Text variant="title2">{t('common.somethingWentWrong')}</Text>
          <Button
            label={t('common.retry')}
            onPress={() => {
              void session.retry();
            }}
          />
          <Button label={t('common.back')} variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  if (session.state.status === 'checking' || session.state.status === 'starting') {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    );
  }

  const distance = formatDistance(distanceM);
  const duration = formatDuration(elapsedS);
  // The rolling window, not distance/elapsed. A whole-walk average counts the
  // minute spent waiting for the first fix as walking, which is what made the
  // opening pace read as nonsense and never quite recover.
  const pace = formatPace(speedMps);
  const enclosed = preview && preview.areaM2 > 0 ? formatArea(preview.areaM2) : null;

  // No fix yet. Worth saying out loud: an empty map and a 0 m readout look
  // identical to a broken app, and the first fix can take 30 s from cold.
  const isWaitingForFirstFix = path.length === 0;
  // The hint lingers a little past the last bad sample so it does not blink on
  // and off as the accuracy hovers around the threshold.
  const isGpsWeak = weakGpsAt !== null && Date.now() - weakGpsAt < 20_000;

  // Mounting without an initialRegion drops the map at the library default,
  // which is the entire globe. A resumed walk (FR-15) already knows where it
  // was; a fresh one holds the launch city for the second or two until the
  // first fix arrives and reframes.
  const first = path[0];
  const initialRegion: Region = {
    latitude: first?.lat ?? LAUNCH_CITY.latitude,
    longitude: first?.lng ?? LAUNCH_CITY.longitude,
    latitudeDelta: REGION_DELTA.street,
    longitudeDelta: REGION_DELTA.street,
  };

  return (
    <Screen edges={[]} bleed>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        // Every route to this screen — the rationale, or the map's shortcut
        // past it — checks the grant first, so it is always in hand here.
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
          coordinates={path.map(({lat, lng}) => ({latitude: lat, longitude: lng}))}
          strokeColor={theme.colors.trail}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />

        {/*
          The head of the trail. `showsUserLocation` draws the platform's own
          blue dot, but that dot is the raw fix — this marker sits on the last
          point actually recorded, so a user can see what the walk has captured
          rather than only where the phone thinks it is.

          tracksViewChanges={false} is not optional: it moves on every sample,
          and re-rasterising a custom marker view each time is the classic
          react-native-maps frame drop (NFR-03).
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
        {preview && preview.ring.length >= 3 ? (
          <MapPolygon
            coordinates={preview.ring.map(({lat, lng}) => ({latitude: lat, longitude: lng}))}
            fillColor={theme.colors.previewFill}
            strokeColor={theme.colors.previewStroke}
            strokeWidth={2}
          />
        ) : null}
      </MapView>

      <View style={[styles.hud, {paddingBottom: insets.bottom + theme.spacing.lg}]}>
        <View style={styles.metrics}>
          <Metric label={t('walk.distance')} value={t(distance.i18nKey, {value: distance.value})} />
          <Metric label={t('walk.duration')} value={t(duration.i18nKey, duration.params)} />
          <Metric
            label={t('walk.pace')}
            value={pace ? t('units.paceMinPerKm', {value: pace}) : '—'}
          />
          <Metric
            label={t('walk.enclosedArea')}
            value={enclosed ? t(enclosed.i18nKey, {value: enclosed.value}) : '—'}
            highlighted={canClaim}
          />
        </View>

        {isWaitingForFirstFix ? (
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
            {t('walk.loopReadyBody', {
              area: enclosed ? t(enclosed.i18nKey, {value: enclosed.value}) : '',
            })}
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
            icon={
              <Icon name={phase === 'paused' ? 'play' : 'pause'} size={18} color="textPrimary" />
            }
            onPress={() => {
              void (phase === 'paused' ? recorder.resume() : recorder.pause());
            }}
          />
          <Button
            label={canClaim ? t('walk.loopReadyConfirm') : t('walk.finish')}
            icon={<Icon name="flag" size={18} color="onAccent" />}
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
          icon={<Icon name="trash" size={16} color="accent" />}
          onPress={handleDiscard}
        />
      </View>
    </Screen>
  );
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
    <View style={styles.metric}>
      <Text variant="metricLabel" color="textTertiary">
        {label.toUpperCase()}
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
