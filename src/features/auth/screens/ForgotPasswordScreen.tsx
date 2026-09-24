import React, {useCallback, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useTheme} from '@core/theme/ThemeProvider';

import {sendPasswordReset} from '../api/authApi';
import {useAuthStore} from '../store/authStore';

import {useAuthFormStyles} from './authFormStyles';

/** Step 1 of 3: ask for the address to send a recovery code to. */
export function ForgotPasswordScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const navigation = useNavigation();
  const setRecoveringPassword = useAuthStore(state => state.setRecoveringPassword);

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const address = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(t('auth.emailInvalid'));
      return;
    }

    setIsSubmitting(true);
    try {
      await sendPasswordReset(address);
      // Raised BEFORE the code is verified, not after. Verifying creates a
      // session, and if the flag were set then, RootNavigator would swap to
      // the main app in the gap — the user would land on the map with their
      // old password still in place.
      setRecoveringPassword(true);
      navigation.navigate('VerifyOtp', {email: address});
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, navigation, setRecoveringPassword, t]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="display">{t('passwordReset.title')}</Text>
        <Text variant="body" color="textSecondary">
          {t('passwordReset.subtitle')}
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.email')}
            placeholderTextColor={theme.colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('auth.email')}
            returnKeyType="go"
            onSubmitEditing={() => {
              void handleSubmit();
            }}
          />

          {error ? (
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            label={t('passwordReset.sendCode')}
            loading={isSubmitting}
            onPress={() => {
              void handleSubmit();
            }}
          />
          <Button
            label={t('common.back')}
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </View>
      </View>
    </Screen>
  );
}
