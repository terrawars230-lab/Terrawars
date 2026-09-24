import React, {useCallback, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useTheme} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';

import {sendPasswordReset, verifyPasswordResetOtp} from '../api/authApi';
import {useAuthStore} from '../store/authStore';

import {useAuthFormStyles} from './authFormStyles';

const OTP_LENGTH = 6;

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

  const handleVerify = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (token.length !== OTP_LENGTH) {
      setError(t('passwordReset.otpTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      await verifyPasswordResetOtp(email, token);
    } catch (caught) {
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
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsResending(false);
    }
  }, [email, t]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="display">{t('passwordReset.otpTitle')}</Text>
        <Text variant="body" color="textSecondary">
          {t('passwordReset.otpSubtitle', {email})}
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('passwordReset.otpPlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            value={token}
            // Stripped rather than validated: iOS autofill pastes the code with
            // surrounding words, and a paste that silently fails validation is
            // worse than one that keeps the digits.
            onChangeText={value => setToken(value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
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
            label={t('passwordReset.resend')}
            variant="ghost"
            loading={isResending}
            onPress={() => {
              void handleResend();
            }}
          />
          <Button
            label={t('common.back')}
            variant="ghost"
            onPress={() => {
              // Leaving here abandons the recovery, so the flag has to come
              // down with it — otherwise a later sign-in lands on the
              // new-password screen with nothing to reset.
              setRecoveringPassword(false);
              navigation.goBack();
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
