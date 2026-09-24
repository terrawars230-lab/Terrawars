import React, {useCallback, useMemo} from 'react';

import {Linking, Platform, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import {openAppSettings} from '@services/permissions/permissions';

const logger = createLogger('battery-guidance');

/**
 * "Keep your walk running" (doc 06 §8.2).
 *
 * Xiaomi, Oppo, Vivo, Samsung and Transsion (Infinix, Tecno, itel) kill
 * foreground services despite Android's own rules — the most common phones in
 * the launch market. Without this, walks silently die in a pocket and the
 * player concludes the game is broken.
 *
 * Deliberately a guide rather than a direct "ignore battery optimisations"
 * prompt: Play restricts REQUEST_IGNORE_BATTERY_OPTIMIZATIONS to a short list
 * of app types, and a fitness-style game is not reliably on it. Opening the
 * settings list the user changes themselves needs no permission at all.
 */

type OemFamily = 'xiaomi' | 'oppo' | 'vivo' | 'samsung' | 'huawei' | 'transsion' | 'other';

const OEM_PATTERNS: [RegExp, OemFamily][] = [
  [/xiaomi|redmi|poco/i, 'xiaomi'],
  [/oppo|realme|oneplus/i, 'oppo'],
  [/vivo|iqoo/i, 'vivo'],
  [/samsung/i, 'samsung'],
  [/huawei|honor/i, 'huawei'],
  [/infinix|tecno|itel/i, 'transsion'],
];

function detectOem(): OemFamily {
  if (Platform.OS !== 'android') {
    return 'other';
  }
  const constants = Platform.constants as {Manufacturer?: string; Brand?: string};
  const name = `${constants.Manufacturer ?? ''} ${constants.Brand ?? ''}`;
  return OEM_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
}

export function BatteryGuidanceScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const oem = useMemo(detectOem, []);

  const openBatterySettings = useCallback(async () => {
    try {
      // The system list of battery-optimised apps. Available on every Android
      // version we support and needs no permission.
      await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch (error) {
      logger.warn('Battery settings intent unavailable; opening app settings', {
        error: String(error),
      });
      await openAppSettings();
    }
  }, []);

  const done = useCallback(() => {
    storage.setBoolean(StorageKeys.batteryGuidanceShown, true);
    navigation.goBack();
  }, [navigation]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <Text variant="title1" accessibilityRole="header">
          {t('battery.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('battery.body')}
        </Text>

        <View style={styles.card}>
          <Text variant="kicker" color="accentText">
            {t('battery.stepsTitle')}
          </Text>
          <Text variant="body">{t(`battery.steps.${oem}`)}</Text>
        </View>

        <View style={styles.actions}>
          {Platform.OS === 'android' ? (
            <Button
              label={t('battery.openSettings')}
              onPress={() => {
                void openBatterySettings();
              }}
            />
          ) : null}
          <Button
            label={t('battery.openAppSettings')}
            variant="secondary"
            onPress={() => {
              void openAppSettings();
            }}
          />
          <Button label={t('common.done')} variant="ghost" onPress={done} />
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
    paddingVertical: theme.spacing.xxl,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hudBorder,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
}));
