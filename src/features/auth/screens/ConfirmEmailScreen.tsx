import React, {useCallback, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useCooldown} from '@core/hooks/useCooldown';
import {useTheme} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';

import {resendConfirmationEmail, verifySignUpOtp} from '../api/authApi';
import {OTP_LENGTH, sanitiseOtp} from '../utils/validation';

import {useAuthFormStyles} from './authFormStyles';

/** Seconds before "send it again" is allowed again. */
const RESEND_COOLDOWN_S = 60;

/**
 * FR-01: confirms a new account with the code from the sign-up email.
 *
 * No navigation on success. Verifying the code creates a session, and the auth
 * store's listener swaps RootNavigator to the signed-in tree on its own.
 *
 * The email also carries a link. Tapping that verifies the address in a
 * browser but cannot sign the app in, which is why "I've confirmed — sign in"
 * is offered here too: it is the way forward for a user who used the link.
 */
export function ConfirmEmailScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const navigation = useNavigation();
  const {email} = useRoute<RouteProp<RootStackParamList, 'ConfirmEmail'>>().params;

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const {remaining: cooldownRemaining, start: startCooldown} = useCooldown(RESEND_COOLDOWN_S);

  const handleVerify = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (token.length !== OTP_LENGTH) {
      setError(t('passwordReset.otpTooShort', {length: OTP_LENGTH}));
      return;
    }

    setIsVerifying(true);
    try {
      await verifySignUpOtp(email, token);
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsVerifying(false);
    }
  }, [email, t, token]);

  const handleResend = useCallback(async () => {
    setError(null);
    setNotice(null);
    setIsResending(true);
    try {
      await resendConfirmationEmail(email);
      setNotice(t('auth.confirmationResent'));
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
          {t('auth.confirmEmailTitle')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('auth.confirmEmailBody', {email})}
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
            accessibilityLabel={t('auth.confirmCodeLabel')}
            returnKeyType="go"
            onSubmitEditing={() => {
              void handleVerify();
            }}
          />

          <Text variant="caption" color="textTertiary">
            {t('auth.confirmEmailHint')}
          </Text>

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
            label={t('auth.confirmAccount')}
            loading={isVerifying}
            onPress={() => {
              void handleVerify();
            }}
          />
          <Button
            label={
              cooldownRemaining > 0
                ? t('auth.resendIn', {seconds: cooldownRemaining})
                : t('auth.resendConfirmation')
            }
            variant="ghost"
            loading={isResending}
            disabled={cooldownRemaining > 0}
            onPress={() => {
              void handleResend();
            }}
          />
          <Button
            label={t('auth.alreadyConfirmed')}
            variant="ghost"
            onPress={() => navigation.navigate('SignIn')}
          />
          <Button
            label={t('auth.useDifferentEmail')}
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </View>
      </View>
    </Screen>
  );
}
