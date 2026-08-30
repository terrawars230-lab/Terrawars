import React, {useCallback, useState} from 'react';

import {KeyboardAvoidingView, Platform, TextInput, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {useAuthStore} from '../store/authStore';

export function SignUpScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const navigation = useNavigation();
  const signUp = useAuthStore(state => state.signUp);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!isValidEmail(email)) {
      setError(t('auth.emailInvalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      await signUp({email, password});
      // No navigation call here. Either a session arrives and RootNavigator
      // swaps the tree, or the project requires email confirmation and the
      // listener picks the session up when the user follows the link.
    } catch (caught) {
      setError(
        ApiError.isApiError(caught)
          ? t(errorMessageKey(caught.code))
          : t('auth.invalidCredentials'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, signUp, t]);

  return (
    <Screen scrollable>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <Text variant="display">{t('auth.signUpTitle')}</Text>

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

/**
 * Shape check only.
 *
 * Deliberately permissive: the authoritative validation is the confirmation
 * email. A stricter regex rejects valid addresses (plus-addressing, new TLDs,
 * non-ASCII local parts) and the failure mode is a user who cannot sign up at
 * all — much worse than a typo caught one step later.
 */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const useStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.xl,
  },
  form: {
    gap: theme.spacing.md,
  },
  input: {
    minHeight: theme.layout.minTouchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body.fontSize,
  },
  actions: {
    gap: theme.spacing.sm,
  },
}));
