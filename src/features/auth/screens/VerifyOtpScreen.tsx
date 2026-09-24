import React, {useCallback, useEffect, useRef, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useCooldown} from '@core/hooks/useCooldown';
import {useTheme} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';

import {sendPasswordReset, verifyPasswordResetOtp} from '../api/authApi';
import {useAuthStore} from '../store/authStore';
import {OTP_LENGTH, sanitiseOtp} from '../utils/validation';

import {useAuthFormStyles} from './authFormStyles';

/** Seconds before "send a new code" is allowed again. */
const RESEND_COOLDOWN_S = 60;

/**
 * Step 2 of 3: exchange the emailed code for a session.
 *
 * No navigation on success. Verifying signs the user in, and the recovery flag
 * raised on the previous screen is what makes RootNavigator render the
 * new-password screen instead of the map.
 */
export function VerifyOtpScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const navigation = useNavigation();
  const {email} = useRoute<RouteProp<RootStackParamList, 'VerifyOtp'>>().params;
  const setRecoveringPassword = useAuthStore(state => state.setRecoveringPassword);

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const {remaining: cooldownRemaining, start: startCooldown} = useCooldown(RESEND_COOLDOWN_S);

  // Leaving this screen by ANY route — the back button, the Android back key,
  // the iOS swipe — abandons the recovery, so the flag comes down with it.
  // Only the button used to lower it; a swipe left it raised, and the user's
  // next ordinary sign-in landed on a "choose a new password" screen they
  // never asked for. A successful verify swaps the whole navigator instead of
  // removing this screen, so it does not trip this.
  const verified = useRef(false);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        if (!verified.current) {
          setRecoveringPassword(false);
        }
      }),
    [navigation, setRecoveringPassword],
  );

  const handleVerify = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (token.length !== OTP_LENGTH) {
      setError(t('passwordReset.otpTooShort', {length: OTP_LENGTH}));
      return;
    }

    setIsSubmitting(true);
    try {
      verified.current = true;
      await verifyPasswordResetOtp(email, token);
    } catch (caught) {
      verified.current = false;
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, t, token]);

  const handleResend = useCallback(async () => {
    setError(null);
    setNotice(null);
    setIsResending(true);
    try {
      await sendPasswordReset(email);
      setNotice(t('passwordReset.resent'));
      startCooldown();
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsResending(false);
    }
  }, [email, startCooldown, t]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="display" accessibilityRole="header">
          {t('passwordReset.otpTitle')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('passwordReset.otpSubtitle', {email})}
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('passwordReset.otpPlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            value={token}
            onChangeText={value => setToken(sanitiseOtp(value))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={OTP_LENGTH}
            accessibilityLabel={t('passwordReset.otpTitle')}
            returnKeyType="go"
            onSubmitEditing={() => {
              void handleVerify();
            }}
          />

          {error ? (
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          {notice ? (
            <Text variant="caption" color="success" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            label={t('passwordReset.verify')}
            loading={isSubmitting}
            onPress={() => {
              void handleVerify();
            }}
          />
          <Button
            label={
              cooldownRemaining > 0
                ? t('auth.resendIn', {seconds: cooldownRemaining})
                : t('passwordReset.resend')
            }
            variant="ghost"
            loading={isResending}
            disabled={cooldownRemaining > 0}
            onPress={() => {
              void handleResend();
            }}
          />
          <Button label={t('common.back')} variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </Screen>
  );
}
