import React, {useCallback, useState} from 'react';

import {KeyboardAvoidingView, Platform, TextInput, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useTheme} from '@core/theme/ThemeProvider';

import {ConsentCheckbox} from '../components/ConsentCheckbox';
import {useAuthStore} from '../store/authStore';
import {isValidEmail, MIN_PASSWORD_LENGTH, normaliseEmail} from '../utils/validation';

import {useAuthFormStyles} from './authFormStyles';

export function SignUpScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const navigation = useNavigation();
  const signUp = useAuthStore(state => state.signUp);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasConsented, setHasConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!isValidEmail(email)) {
      setError(t('auth.emailInvalid'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordTooShort', {length: MIN_PASSWORD_LENGTH}));
      return;
    }
    if (!hasConsented) {
      setError(t('auth.consentRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signUp({email, password});

      // Two outcomes, and both need saying. With a session, RootNavigator
      // swaps the tree on its own. Without one the account exists but needs
      // the emailed code — staying on an untouched form would look like the
      // button did nothing.
      if (result.needsEmailConfirmation) {
        navigation.navigate('ConfirmEmail', {email: normaliseEmail(email)});
      }
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, hasConsented, navigation, password, signUp, t]);

  return (
    <Screen scrollable>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <Text variant="display" accessibilityRole="header">
          {t('auth.signUpTitle')}
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
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('auth.password')}
            accessibilityHint={t('auth.passwordTooShort', {length: MIN_PASSWORD_LENGTH})}
            onSubmitEditing={() => {
              void handleSubmit();
            }}
            returnKeyType="go"
          />

          <ConsentCheckbox checked={hasConsented} onChange={setHasConsented} />

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
            label={t('auth.signUp')}
            loading={isSubmitting}
            onPress={() => {
              void handleSubmit();
            }}
          />
          <Button
            label={t('auth.hasAccountPrompt')}
            variant="ghost"
            onPress={() => navigation.navigate('SignIn')}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
