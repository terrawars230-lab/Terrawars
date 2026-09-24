import React, {useCallback, useState} from 'react';

import {KeyboardAvoidingView, Platform, TextInput, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {resendConfirmationEmail} from '../api/authApi';
import {useAuthStore} from '../store/authStore';

type ResendState = 'idle' | 'sending' | 'sent';

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

  /**
   * Set once sign-up succeeded without a session — the project requires email
   * confirmation. Holding the address rather than a bare boolean is what lets
   * the confirmation panel name it and resend to it.
   */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<ResendState>('idle');

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
      const result = await signUp({email, password});

      // Two outcomes, and both need saying. With a session, RootNavigator
      // swaps the tree on its own and there is nothing to navigate to here.
      // Without one, the account exists but is unusable until the link is
      // followed — and staying on an untouched form would look like the button
      // did nothing.
      if (result.needsEmailConfirmation) {
        setPendingEmail(email.trim().toLowerCase());
      }
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

  const handleResend = useCallback(async () => {
    if (!pendingEmail) {
      return;
    }

    setError(null);
    setResendState('sending');
    try {
      await resendConfirmationEmail(pendingEmail);
      setResendState('sent');
    } catch (caught) {
      // Back to idle, not stuck on 'sending': the usual failure here is the
      // per-hour mailer limit, and the user must be able to try again later.
      setResendState('idle');
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    }
  }, [pendingEmail, t]);

  if (pendingEmail) {
    return (
      <Screen scrollable>
        <View style={styles.container}>
          <Text variant="display">{t('auth.confirmEmailTitle')}</Text>
          <Text variant="body" color="textSecondary">
            {t('auth.confirmEmailBody', {email: pendingEmail})}
          </Text>
          <Text variant="caption" color="textTertiary">
            {t('auth.confirmEmailHint')}
          </Text>

          {resendState === 'sent' ? (
            <Text variant="caption" color="success" accessibilityLiveRegion="polite">
              {t('auth.confirmationResent')}
            </Text>
          ) : null}

          {error ? (
            <Text variant="caption" color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={t('auth.resendConfirmation')}
              loading={resendState === 'sending'}
              onPress={() => {
                void handleResend();
              }}
            />
            <Button
              label={t('auth.useDifferentEmail')}
              variant="ghost"
              onPress={() => {
                // Back to a blank form. Keeping the address would invite a
                // second sign-up with it, which only returns "already
                // registered" — the opposite of what this button offers.
                setPendingEmail(null);
                setResendState('idle');
                setError(null);
                setEmail('');
                setPassword('');
              }}
            />
            <Button
              label={t('auth.hasAccountPrompt')}
              variant="ghost"
              onPress={() => navigation.navigate('SignIn')}
            />
          </View>
        </View>
      </Screen>
    );
  }

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
