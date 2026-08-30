import React, {useCallback, useEffect, useState} from 'react';

import {TextInput, View} from 'react-native';

import {useQueryClient} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {errorMessageKey} from '@core/constants/errorCodes';
import {queryKeys} from '@core/constants/queryKeys';
import {useDebouncedValue} from '@core/hooks/useDebouncedValue';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';

import {isUsernameAvailable, setUsername} from '../api/authApi';

/**
 * Username selection with a live availability check (FR-02).
 *
 * The username is public and permanent in v1, which is why the check is live
 * rather than on submit: finding out your name is taken after tapping Confirm
 * is a bad first experience for the one irreversible choice in the product.
 *
 * The check is debounced. A request per keystroke would be 8–20 round trips per
 * name, and `is_username_available` is a `SECURITY DEFINER` function precisely
 * so it can answer without exposing the profiles table to enumeration.
 */

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const AVAILABILITY_DEBOUNCE_MS = 400;

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function ChooseUsernameScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const queryClient = useQueryClient();

  const [username, setUsernameInput] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebouncedValue(username, AVAILABILITY_DEBOUNCE_MS);

  useEffect(() => {
    if (debounced.length === 0) {
      setAvailability('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(debounced)) {
      setAvailability('invalid');
      return;
    }

    // `cancelled` guards against a slow response for an earlier name landing
    // after a faster one for the current name — which would show the wrong
    // verdict for what is on screen.
    let cancelled = false;
    setAvailability('checking');

    isUsernameAvailable(debounced)
      .then(available => {
        if (!cancelled) {
          setAvailability(available ? 'available' : 'taken');
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Network trouble is not a verdict. Staying idle lets the user submit
          // and get the authoritative answer from the unique constraint.
          setAvailability('idle');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await setUsername(username);
      // The gate that routes to this screen reads `needs_username` from
      // get_me(), so invalidating the profile is what dismisses it.
      await queryClient.invalidateQueries({queryKey: queryKeys.profile.me()});
    } catch (caught) {
      setError(ApiError.isApiError(caught) ? t(errorMessageKey(caught.code)) : t('errors.UNKNOWN'));
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient, t, username]);

  const statusMessage: Record<Availability, string | null> = {
    idle: null,
    checking: t('username.checking'),
    available: t('username.available', {username}),
    taken: t('username.taken', {username}),
    invalid: t('username.invalid'),
  };

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="title1">{t('username.title')}</Text>
        <Text variant="body" color="textSecondary">
          {t('username.subtitle')}
        </Text>

        <TextInput
          style={styles.input}
          placeholder={t('username.placeholder')}
          placeholderTextColor={theme.colors.textTertiary}
          value={username}
          // Lowercased on input rather than on submit, so what the user types is
          // what the availability check tested and what they end up with.
          onChangeText={value => setUsernameInput(value.toLowerCase().trim())}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          accessibilityLabel={t('username.title')}
        />

        <Text variant="caption" color="textTertiary">
          {t('username.rules')}
        </Text>

        {statusMessage[availability] ? (
          <Text
            variant="caption"
            color={availability === 'available' ? 'success' : 'danger'}
            accessibilityLiveRegion="polite">
            {statusMessage[availability]}
          </Text>
        ) : null}

        {error ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button
          label={t('username.confirm')}
          loading={isSubmitting}
          disabled={availability !== 'available'}
          onPress={() => {
            void handleSubmit();
          }}
          style={styles.submit}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
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
    marginTop: theme.spacing.lg,
  },
  submit: {
    marginTop: theme.spacing.xl,
  },
}));
