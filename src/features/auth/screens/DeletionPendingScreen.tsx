import React, {useState} from 'react';

import {View} from 'react-native';

import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {makeStyles} from '@core/theme/ThemeProvider';
import {openExternalUrl, supportMailto} from '@core/utils/links';

import {useAuthStore} from '../store/authStore';

/**
 * Shown when a signed-in account is inside its FR-06 deletion grace period.
 *
 * The deletion was asked for and confirmed, and the hard delete will run
 * regardless. Letting the account play on in the meantime would record walks
 * and win territory that is about to be erased — so the one thing on offer is
 * to sign out, or to write to support if the deletion was a mistake.
 */
export function DeletionPendingScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const signOut = useAuthStore(state => state.signOut);
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <Screen>
      <View style={styles.container}>
        <Text variant="title1" accessibilityRole="header">
          {t('deletionPending.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('deletionPending.body')}
        </Text>
        <View style={styles.actions}>
          <Button
            label={t('auth.signOut')}
            loading={isSigningOut}
            onPress={() => {
              setIsSigningOut(true);
              void signOut().finally(() => setIsSigningOut(false));
            }}
          />
          <Button
            label={t('settings.contactSupport')}
            variant="ghost"
            onPress={() => {
              void openExternalUrl(supportMailto(t('deletionPending.supportSubject')));
            }}
          />
        </View>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
}));
