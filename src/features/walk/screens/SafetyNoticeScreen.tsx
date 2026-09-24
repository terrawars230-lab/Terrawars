import React, {useCallback} from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';

import {Button, Icon, Screen, Text} from '@components/index';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';

/**
 * "Walk safely" (doc 06 §7), before the first walk and from settings.
 *
 * Not boilerplate: a game that rewards routing people through unfamiliar
 * streets has a real duty here, and both stores look for it in an app that
 * sends people outside. It also carries the doc 06 §4 home-address warning —
 * a loop started at the front door makes that door the corner of a public
 * polygon — which the player can only act on if they are told before they
 * walk, not after.
 */
export function SafetyNoticeScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SafetyNotice'>>();
  const continueToWalk = route.params?.continueToWalk === true;

  const acknowledge = useCallback(() => {
    storage.setBoolean(StorageKeys.safetyNoticeAcknowledged, true);
    if (continueToWalk) {
      // The rationale screen steps straight through when location is granted.
      navigation.replace('LocationRationale', {returnTo: 'ActiveWalk'});
    } else {
      navigation.goBack();
    }
  }, [continueToWalk, navigation]);

  return (
    <Screen scrollable>
      <View style={styles.container}>
        <View style={styles.badge}>
          <Icon name="alert" size={30} color="warning" />
        </View>

        <Text variant="title1" accessibilityRole="header">
          {t('safety.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('safety.body')}
        </Text>

        <View style={styles.points}>
          <Point title={t('safety.roadTitle')} body={t('safety.roadBody')} />
          <Point title={t('safety.placesTitle')} body={t('safety.placesBody')} />
          <Point title={t('safety.homeTitle')} body={t('safety.homeBody')} />
        </View>

        <Button label={t('safety.acknowledge')} onPress={acknowledge} style={styles.action} />
      </View>
    </Screen>
  );
}

function Point({title, body}: {title: string; body: string}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.point}>
      <View style={styles.dot} />
      <View style={styles.pointText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="label" color="textSecondary">
          {body}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  points: {
    gap: theme.spacing.lg,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
    marginTop: theme.spacing.sm,
  },
  pointText: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  action: {
    marginTop: theme.spacing.lg,
  },
}));
