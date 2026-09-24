import React from 'react';

import {Linking, Pressable, View} from 'react-native';

import {Trans, useTranslation} from 'react-i18next';

import {Icon, Text} from '@components/index';
import {env} from '@core/config/env';
import {createLogger} from '@core/logger/logger';
import {makeStyles} from '@core/theme/ThemeProvider';

import {MIN_SIGNUP_AGE} from '../utils/validation';

const logger = createLogger('consent');

export interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Agreement to the Terms and Privacy Policy, and the minimum-age confirmation,
 * taken at sign-up.
 *
 * Both stores expect the privacy policy to be reachable from inside the app,
 * and an account created without the terms ever being shown leaves the
 * "no fraudulent location data" rule (doc 06 §7) unenforceable. The links open
 * the published pages in the browser, so the text the user agrees to is the
 * one the store listing links to as well.
 */
export function ConsentCheckbox({checked, onChange}: ConsentCheckboxProps): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      accessibilityLabel={t('auth.consentA11y', {age: MIN_SIGNUP_AGE})}
      onPress={() => onChange(!checked)}
      style={styles.row}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Icon name="check" size={16} color="onAccent" strokeWidth={2.4} /> : null}
      </View>
      <Text variant="caption" color="textSecondary" style={styles.text}>
        <Trans
          i18nKey="auth.consent"
          values={{age: MIN_SIGNUP_AGE}}
          components={{
            terms: <Link url={env.links.terms} />,
            privacy: <Link url={env.links.privacyPolicy} />,
          }}
        />
      </Text>
    </Pressable>
  );
}

/** An inline link inside running text. Receives its label from `Trans`. */
function Link({url, children}: {url: string; children?: React.ReactNode}): React.JSX.Element {
  const styles = useStyles();
  return (
    <Text
      variant="caption"
      color="accentText"
      style={styles.link}
      accessibilityRole="link"
      onPress={() => {
        Linking.openURL(url).catch(() => {
          logger.warn('Could not open a legal page');
        });
      }}>
      {children}
    </Text>
  );
}

const useStyles = makeStyles(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    minHeight: theme.layout.minTouchTarget,
    paddingVertical: theme.spacing.xs,
  },
  box: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: theme.radius.xs / 2,
    borderWidth: 1.5,
    borderColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: theme.colors.accent,
  },
  text: {
    flex: 1,
  },
  link: {
    textDecorationLine: 'underline',
  },
}));
