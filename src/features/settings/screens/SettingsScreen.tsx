import React, {useCallback, useState} from 'react';

import {Alert, Pressable, Switch, View} from 'react-native';

import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import {requestAccountDeletion} from '@features/auth/api/authApi';
import {useAuthStore} from '@features/auth/store/authStore';

/**
 * Settings (FR-06, FR-72, doc 06 §4.5, §7).
 *
 * Three things here are compliance obligations rather than features:
 *  - in-app account deletion (FR-06, required by Play policy);
 *  - individually toggleable non-essential notifications (FR-72);
 *  - the "hide the start of my walks" control (doc 06 §4.5) — a loop that
 *    starts at someone's front door otherwise puts their home on a public map.
 */
export function SettingsScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const signOut = useAuthStore(state => state.signOut);

  const [hideWalkStart, setHideWalkStart] = useState(() =>
    storage.getBoolean(StorageKeys.hideWalkStart, false),
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const toggleHideWalkStart = useCallback((value: boolean) => {
    setHideWalkStart(value);
    storage.setBoolean(StorageKeys.hideWalkStart, value);
  }, []);

  const confirmDelete = useCallback(() => {
    Alert.alert(t('settings.deleteAccountTitle'), t('settings.deleteAccountBody'), [
      {text: t('common.cancel'), style: 'cancel'},
      {
        text: t('settings.deleteAccount'),
        style: 'destructive',
        onPress: () => {
          setIsDeleting(true);
          void requestAccountDeletion().finally(() => setIsDeleting(false));
        },
      },
    ]);
  }, [t]);

  return (
    <Screen scrollable>
      <Text variant="title1" style={styles.title}>
        {t('settings.title')}
      </Text>

      <Section title={t('settings.privacy')}>
        <Row
          label={t('settings.hideWalkStart')}
          hint={t('settings.hideWalkStartHint', {distance: `${WALK_LIMITS.pathPrivacyTrimM} m`})}
          control={
            <Switch
              value={hideWalkStart}
              onValueChange={toggleHideWalkStart}
              trackColor={{true: theme.colors.accent, false: theme.colors.border}}
              accessibilityLabel={t('settings.hideWalkStart')}
            />
          }
        />
      </Section>

      <Section title={t('settings.account')}>
        <Button
          label={t('auth.signOut')}
          variant="secondary"
          onPress={() => {
            void signOut();
          }}
        />
        <Button
          label={t('settings.deleteAccount')}
          variant="danger"
          loading={isDeleting}
          onPress={confirmDelete}
          style={styles.dangerButton}
        />
      </Section>
    </Screen>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text variant="metricLabel" color="textTertiary">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Row({
  label,
  hint,
  control,
  onPress,
}: {
  label: string;
  hint?: string;
  control?: React.ReactNode;
  onPress?: () => void;
}): React.JSX.Element {
  const styles = useStyles();

  const inner = (
    <>
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" color="textTertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      {control}
    </>
  );

  if (onPress) {
    return (
      <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.row}>{inner}</View>;
}

const useStyles = makeStyles(theme => ({
  title: {
    marginTop: theme.spacing.lg,
  },
  section: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    minHeight: theme.layout.minTouchTarget,
  },
  rowText: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  dangerButton: {
    marginTop: theme.spacing.sm,
  },
}));
