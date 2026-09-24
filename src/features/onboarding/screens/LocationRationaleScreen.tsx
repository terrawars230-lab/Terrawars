import React, {useCallback, useEffect, useRef, useState} from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';

import {Button, Icon, Loader, Screen, Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';
import {
  checkLocationPermission,
  openAppSettings,
  requestLocationPermission,
  requestWalkNotificationsOnce,
  type PermissionOutcome,
} from '@services/permissions/permissions';

/**
 * The prominent disclosure required before the system permission dialog
 * (doc 06 §5, FR-10).
 *
 * This screen is not a nicety. Google Play's User Data policy requires a
 * prominent, in-app disclosure — shown before the runtime prompt, in the
 * normal flow of the app — that says what is collected, when, how it is used
 * and whether it is shared. It must describe collection while the screen is
 * off or another app is open, because the walk keeps recording then. On
 * Android it also has to be right first time: a second denial is permanent.
 *
 * The bullets are the things a reasonable person actually wants to know —
 * when, who sees it, how long it is kept.
 */
export function LocationRationaleScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  // Typed as the stack's own prop, not the generic NavigationProp: `replace`
  // only exists on a stack navigator, and this also keeps route params checked.
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LocationRationale'>>();

  const [outcome, setOutcome] = useState<PermissionOutcome | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  /** True until we know whether this screen needs to be shown at all. */
  const [isChecking, setIsChecking] = useState(true);

  const returnTo = route.params?.returnTo;

  const proceed = useCallback(() => {
    if (returnTo === 'ActiveWalk') {
      navigation.replace('ActiveWalk');
    } else {
      navigation.goBack();
    }
  }, [navigation, returnTo]);

  /**
   * Skips this screen when a precise grant already exists.
   *
   * doc 06 §5 requires the disclosure *before the system dialog*. Once the
   * grant exists there is no dialog left to precede, so showing it again is
   * pure friction.
   */
  const hasChecked = useRef(false);
  useEffect(() => {
    if (hasChecked.current) {
      return;
    }
    hasChecked.current = true;

    void (async () => {
      const current = await checkLocationPermission();
      if (current === 'granted') {
        proceed();
        return;
      }
      setOutcome(current);
      setIsChecking(false);
    })();
  }, [proceed]);

  const handleGrant = useCallback(async () => {
    setIsRequesting(true);
    try {
      const result = await requestLocationPermission();
      setOutcome(result);

      if (result !== 'granted') {
        return;
      }

      // Android 13+: the walk's own notification. Asked right after location,
      // once ever, under the same explanation — and a refusal changes nothing
      // about whether the walk records.
      await requestWalkNotificationsOnce();
      proceed();
    } finally {
      setIsRequesting(false);
    }
  }, [proceed]);

  // Nothing to disclose yet — showing the copy for a frame and then navigating
  // away would flash the screen on every walk start.
  if (isChecking) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }

  const isBlocked = outcome === 'blocked';
  const isApproximate = outcome === 'approximate';

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <View style={styles.badge}>
          <Icon name="crosshair" size={30} color="accent" />
        </View>

        <Text variant="title1" accessibilityRole="header">
          {t('permissions.locationTitle')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('permissions.locationBody')}
        </Text>

        <View style={styles.bullets}>
          <Bullet text={t('permissions.locationBullet1')} />
          <Bullet text={t('permissions.locationBullet2')} />
          <Bullet text={t('permissions.locationBullet3')} />
        </View>

        {isBlocked ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            {t('permissions.locationDenied')}
          </Text>
        ) : null}

        {isApproximate ? (
          <Text variant="caption" color="warning" accessibilityRole="alert">
            {t('permissions.locationApproximate')}
          </Text>
        ) : null}

        {outcome === 'unavailable' ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            {t('permissions.locationUnavailable')}
          </Text>
        ) : null}

        <View style={styles.actions}>
          {isBlocked ? (
            <Button
              label={t('permissions.locationOpenSettings')}
              onPress={() => {
                void openAppSettings();
              }}
            />
          ) : (
            <Button
              label={isApproximate ? t('permissions.locationGrantPrecise') : t('permissions.locationGrant')}
              loading={isRequesting}
              onPress={() => {
                void handleGrant();
              }}
            />
          )}
          {isApproximate ? (
            <Button
              label={t('permissions.locationOpenSettings')}
              variant="secondary"
              onPress={() => {
                void openAppSettings();
              }}
            />
          ) : null}
          <Button label={t('common.notNow')} variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </Screen>
  );
}

function Bullet({text}: {text: string}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.bullet}>
      <View style={styles.dot} />
      <Text variant="body" style={styles.bulletText}>
        {text}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bullets: {
    gap: theme.spacing.md,
  },
  bullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
    marginTop: theme.spacing.sm,
  },
  bulletText: {
    flex: 1,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
}));
