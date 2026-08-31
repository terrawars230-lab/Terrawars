import React, {useCallback, useEffect, useRef, useState} from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';

import {Button, Loader, Screen, Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';
import {
  checkLocationPermission,
  openAppSettings,
  requestLocationPermission,
  requestMotionPermissionOnce,
} from '@services/permissions/permissions';

/**
 * The prominent disclosure required before the system permission dialog
 * (doc 06 §5, FR-10).
 *
 * This screen is not a nicety. Play policy requires a prominent disclosure for
 * continuous location, and doc 06 §5 names a context-free permission prompt as
 * the main cause of first-session drop-off. On Android it also has to be right
 * first time: a second denial is permanent, and this screen is the only chance
 * to explain before that happens.
 *
 * The three bullets are the three things a reasonable person actually wants to
 * know — when, who sees it, how long it is kept.
 */
export function LocationRationaleScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  // Typed as the stack's own prop, not the generic NavigationProp: `replace`
  // only exists on a stack navigator, and this also keeps route params checked.
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'LocationRationale'>>();

  const [isBlocked, setIsBlocked] = useState(false);
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
   * Skips this screen when location is already granted.
   *
   * doc 06 §5 requires the disclosure *before the system dialog*. Once the
   * grant exists there is no dialog left to precede, so showing it again is
   * pure friction — and this screen sits in front of every single walk, which
   * is why it read as the app asking for permission over and over.
   */
  const hasChecked = useRef(false);
  useEffect(() => {
    if (hasChecked.current) {
      return;
    }
    hasChecked.current = true;

    void (async () => {
      const outcome = await checkLocationPermission();
      if (outcome === 'granted') {
        proceed();
        return;
      }
      if (outcome === 'blocked') {
        setIsBlocked(true);
      }
      setIsChecking(false);
    })();
  }, [proceed]);

  const handleGrant = useCallback(async () => {
    setIsRequesting(true);
    try {
      const outcome = await requestLocationPermission();

      if (outcome === 'blocked') {
        // Cannot be asked again in-app. The only route left is Settings.
        setIsBlocked(true);
        return;
      }

      if (outcome !== 'granted') {
        return;
      }

      // doc 06 §2: the step-counter cross-check. Asked after location, once
      // ever — a refusal is a soft flag, never a blocked walk, so re-prompting
      // before every walk would cost goodwill and buy no signal.
      await requestMotionPermissionOnce();

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

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="title1">{t('permissions.locationTitle')}</Text>
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
              label={t('permissions.locationGrant')}
              loading={isRequesting}
              onPress={() => {
                void handleGrant();
              }}
            />
          )}
          <Button label={t('common.back')} variant="ghost" onPress={() => navigation.goBack()} />
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
