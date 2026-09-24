import React, {useCallback, useState} from 'react';

import {Alert, Platform, Pressable, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Icon, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {appInfo} from '@core/config/appInfo';
import {env} from '@core/config/env';
import {errorMessageKey} from '@core/constants/errorCodes';
import {makeStyles} from '@core/theme/ThemeProvider';
import {openExternalUrl, supportMailto} from '@core/utils/links';
import {requestAccountDeletion} from '@features/auth/api/authApi';
import {useAuthStore} from '@features/auth/store/authStore';
import {queuedClaimCount} from '@features/walk/services/claimQueue';
import {useWalkStore} from '@features/walk/store/walkStore';

/**
 * Settings (FR-06, doc 06 §4, §7).
 *
 * Several rows here are store obligations rather than features:
 *  - in-app account deletion (FR-06; Play policy and App Store 5.1.1(v));
 *  - the privacy policy, reachable from inside the app (Play User Data
 *    policy; App Store 5.1.1(i));
 *  - a way to contact the developer.
 *
 * The "hide the start of my walks" switch that used to sit here is gone. It
 * saved a preference nothing ever read — the server trims nothing — so it told
 * players their front door was protected when it was not. doc 06 §4's home
 * warning now lives in the walk-safety notice, where it can be acted on.
 */
export function SettingsScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const signOut = useAuthStore(state => state.signOut);

  const [isDeleting, setIsDeleting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const performSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      Alert.alert(t('common.somethingWentWrong'), t('errors.UNKNOWN'));
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut, t]);

  const confirmSignOut = useCallback(() => {
    // Signing out ends a walk in progress (it belongs to this session), and a
    // queued claim waits until this player signs back in. Both are worth one
    // sentence before the tap, not a surprise after it.
    const walkActive = useWalkStore.getState().phase !== 'idle';
    const pendingClaims = queuedClaimCount();
    const body = walkActive
      ? t('settings.signOutWalkActive')
      : pendingClaims > 0
      ? t('settings.signOutPendingClaims', {count: pendingClaims})
      : t('settings.signOutBody');

    Alert.alert(t('settings.signOutTitle'), body, [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          void performSignOut();
        },
      },
    ]);
  }, [performSignOut, t]);

  const performDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      // On success this signs out, and RootNavigator swaps to the auth stack.
      await requestAccountDeletion();
    } catch (caught) {
      Alert.alert(
        t('settings.deleteFailedTitle'),
        ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'),
      );
    } finally {
      setIsDeleting(false);
    }
  }, [t]);

  const confirmDelete = useCallback(() => {
    Alert.alert(t('settings.deleteAccountTitle'), t('settings.deleteAccountBody'), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('settings.deleteAccount'),
        style: 'destructive',
        onPress: () => {
          void performDelete();
        },
      },
    ]);
  }, [performDelete, t]);

  return (
    <Screen scrollable edges={['bottom']}>
      <Section title={t('settings.walking')}>
        <Row label={t('settings.safetyNotice')} onPress={() => navigation.navigate('SafetyNotice', {})} />
        {Platform.OS === 'android' ? (
          <Row
            label={t('settings.batteryGuidance')}
            hint={t('settings.batteryGuidanceHint')}
            onPress={() => navigation.navigate('BatteryGuidance')}
          />
        ) : null}
      </Section>

      <Section title={t('settings.privacyAndLegal')}>
        <Row
          label={t('settings.privacyPolicy')}
          role="link"
          onPress={() => {
            void openExternalUrl(env.links.privacyPolicy);
          }}
        />
        <Row
          label={t('settings.termsOfService')}
          role="link"
          onPress={() => {
            void openExternalUrl(env.links.terms);
          }}
        />
        <Row
          label={t('settings.contactSupport')}
          hint={env.links.supportEmail}
          role="link"
          onPress={() => {
            void openExternalUrl(supportMailto(t('settings.supportSubject')));
          }}
        />
      </Section>

      <Section title={t('settings.account')}>
        <Button
          label={t('auth.signOut')}
          variant="secondary"
          loading={isSigningOut}
          disabled={isDeleting}
          onPress={confirmSignOut}
        />
        <Button
          label={t('settings.deleteAccount')}
          variant="danger"
          loading={isDeleting}
          disabled={isSigningOut}
          onPress={confirmDelete}
          style={styles.dangerButton}
        />
        <Text variant="caption" color="textTertiary">
          {t('settings.deleteAccountHint')}
        </Text>
      </Section>

      <Text variant="caption" color="textTertiary" align="center" style={styles.version}>
        {t('settings.version', {version: appInfo.version, build: appInfo.buildNumber})}
      </Text>
    </Screen>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text variant="kicker" color="textTertiary" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({
  label,
  hint,
  role = 'button',
  onPress,
}: {
  label: string;
  hint?: string;
  role?: 'button' | 'link';
  onPress: () => void;
}): React.JSX.Element {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" color="textTertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={18} color="iconInactive" />
    </Pressable>
  );
}

const useStyles = makeStyles(theme => ({
  section: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    minHeight: theme.layout.minTouchTarget,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  rowText: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  dangerButton: {
    marginTop: theme.spacing.sm,
  },
  version: {
    marginTop: theme.spacing.xxl,
  },
}));
