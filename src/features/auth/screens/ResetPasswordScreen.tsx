import React, {useCallback, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {useTheme} from '@core/theme/ThemeProvider';

import {updatePassword} from '../api/authApi';
import {useAuthStore} from '../store/authStore';

import {useAuthFormStyles} from './authFormStyles';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Step 3 of 3: set the new password.
 *
 * One action, no back button and no cancel. The session behind this screen was
 * minted by a code from an inbox, and any exit that is not "save" drops the
 * user into the app on the credentials they have just declared lost. Closing
 * the app is the way out: the recovery flag is in memory only, so a relaunch
 * lands on a normal signed-in session.
 */
export function ResetPasswordScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useAuthFormStyles();
  const setRecoveringPassword = useAuthStore(state => state.setRecoveringPassword);

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (password !== repeat) {
      setError(t('passwordReset.mismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(password);
      // Lowering the flag is what hands the user to the main app. The session
      // is already valid, so there is nothing else to do.
      setRecoveringPassword(false);
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [password, repeat, setRecoveringPassword, t]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="display">{t('passwordReset.newTitle')}</Text>
        <Text variant="body" color="textSecondary">
          {t('passwordReset.newSubtitle')}
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('passwordReset.newPassword')}
            placeholderTextColor={theme.colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('passwordReset.newPassword')}
          />
          <TextInput
            style={styles.input}
            placeholder={t('passwordReset.repeatPassword')}
            placeholderTextColor={theme.colors.textTertiary}
            value={repeat}
            onChangeText={setRepeat}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel={t('passwordReset.repeatPassword')}
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

        <Button
          label={t('passwordReset.save')}
          loading={isSubmitting}
          onPress={() => {
            void handleSubmit();
          }}
        />
      </View>
    </Screen>
  );
}
