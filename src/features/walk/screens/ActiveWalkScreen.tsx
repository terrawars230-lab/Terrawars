import React, {useCallback, useEffect, useState} from 'react';

import {Alert, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import MapView, {Polygon as MapPolygon, Polyline, PROVIDER_GOOGLE} from 'react-native-maps';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Loader, Screen, Text} from '@components/index';
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recorder = useWalkRecorder({
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
      setElapsedS(useWalkStore.getState().elapsedSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
  const pace = formatPace(elapsedS > 0 ? distanceM / elapsedS : 0);
  const enclosed = preview && preview.areaM2 > 0 ? formatArea(preview.areaM2) : null;

  return (
    <Screen edges={[]} bleed>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        showsUserLocation
        followsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        {/* FR-13: the live trail. */}
        <Polyline
          coordinates={path.map(({lat, lng}) => ({latitude: lat, longitude: lng}))}
          strokeColor={theme.colors.trail}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />

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

        {canClaim ? (
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
            onPress={() => {
              void (phase === 'paused' ? recorder.resume() : recorder.pause());
            }}
          />
          <Button
            label={canClaim ? t('walk.loopReadyConfirm') : t('walk.finish')}
            loading={isSubmitting}
            onPress={() => {
              void handleFinish();
            }}
          />
        </View>

        <Button label={t('walk.discard')} variant="ghost" size="medium" onPress={handleDiscard} />
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
