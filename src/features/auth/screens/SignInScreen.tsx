import React, {useCallback, useState} from 'react';

import {KeyboardAvoidingView, Platform, TextInput, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useTheme} from '@core/theme/ThemeProvider';

import {resendConfirmationEmail} from '../api/authApi';
import {useAuthStore} from '../store/authStore';
import {isValidEmail, normaliseEmail} from '../utils/validation';

import {useAuthFormStyles} from './authFormStyles';

export function SignInScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const navigation = useNavigation();
  const signIn = useAuthStore(state => state.signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when the account exists but was never confirmed, to offer the way out. */
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setUnconfirmedEmail(null);

    if (!isValidEmail(email)) {
      setError(t('auth.emailInvalid'));
      return;
    }
    // Presence only. The length rule is a sign-up rule; applying it here would
    // lock out an account whose password predates it.
    if (password.length === 0) {
      setError(t('auth.passwordRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn({email, password});
      // No navigation call here. The auth store's listener flips `status` to
      // `signedIn` and RootNavigator swaps the whole tree — navigating manually
      // as well would race that and briefly show two stacks.
    } catch (caught) {
      if (ApiError.isApiError(caught) && caught.code === 'EMAIL_NOT_CONFIRMED') {
        setUnconfirmedEmail(normaliseEmail(email));
      }
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, signIn, t]);

  const goToConfirmation = useCallback(() => {
    if (!unconfirmedEmail) {
      return;
    }
    // A fresh code, so the one they are about to type is not an expired one.
    // Failure is not fatal: the confirmation screen can send another.
    resendConfirmationEmail(unconfirmedEmail).catch(() => undefined);
    navigation.navigate('ConfirmEmail', {email: unconfirmedEmail});
  }, [navigation, unconfirmedEmail]);

  return (
    <Screen scrollable>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <Text variant="display" accessibilityRole="header">
          {t('auth.signInTitle')}
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.email')}
            placeholderTextColor={theme.colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('auth.email')}
          />
          <TextInput
            style={styles.input}
            placeholder={t('auth.password')}
            placeholderTextColor={theme.colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            accessibilityLabel={t('auth.password')}
            onSubmitEditing={() => {
              void handleSubmit();
            }}
            returnKeyType="go"
          />

          {error ? (
            // `alert` so a screen reader announces the failure rather than
            // leaving the user pressing a button that appears to do nothing.
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            label={t('auth.signIn')}
            loading={isSubmitting}
            onPress={() => {
              void handleSubmit();
            }}
          />
          {unconfirmedEmail ? (
            <Button label={t('auth.enterConfirmationCode')} variant="secondary" onPress={goToConfirmation} />
          ) : null}
          <Button
            label={t('auth.forgotPassword')}
            variant="ghost"
            onPress={() => navigation.navigate('ForgotPassword')}
          />
          <Button
            label={t('auth.noAccountPrompt')}
            variant="ghost"
            onPress={() => navigation.navigate('SignUp')}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
