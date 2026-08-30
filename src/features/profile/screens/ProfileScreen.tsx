import React from 'react';

import {View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {Button, EmptyState, Loader, Screen, Text} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import {formatArea, formatDistance} from '@core/utils/format';

import {fetchMyProfile} from '../api/profileApi';

/** Personal stats (FR-04, FR-64). */
export function ProfileScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();

  const {data, isLoading, isError, refetch} = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: fetchMyProfile,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <EmptyState
          title={t('common.somethingWentWrong')}
          actionLabel={t('common.retry')}
          onAction={() => {
            void refetch();
          }}
        />
      </Screen>
    );
  }

  const {stats} = data;
  const totalArea = formatArea(stats.totalAreaM2);
  const distance = formatDistance(stats.totalDistanceM);
  const bestClaim = formatArea(stats.bestClaimM2);
  const stolen = formatArea(stats.areaStolenM2);
  const lost = formatArea(stats.areaLostM2);

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <View style={[styles.colorSwatch, {backgroundColor: data.colorHex}]} />
        <View style={styles.identity}>
          <Text variant="title1">{data.displayName ?? data.username}</Text>
          <Text variant="caption" color="textSecondary">
            @{data.username}
          </Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Text variant="metricLabel" color="textTertiary">
          {t('profile.totalArea').toUpperCase()}
        </Text>
        <Text variant="display" color="accent">
          {t(totalArea.i18nKey, {value: totalArea.value})}
        </Text>
        <Text variant="caption" color="textSecondary">
          {t('leaderboard.yourRank', {rank: stats.rankGlobal})}
        </Text>
      </View>

      <View style={styles.grid}>
        <Stat label={t('profile.parcels')} value={String(stats.parcelsCount)} />
        <Stat label={t('profile.walks')} value={String(stats.walksCount)} />
        <Stat label={t('profile.distance')} value={t(distance.i18nKey, {value: distance.value})} />
        <Stat
          label={t('profile.bestClaim')}
          value={t(bestClaim.i18nKey, {value: bestClaim.value})}
        />
        <Stat label={t('profile.stolen')} value={t(stolen.i18nKey, {value: stolen.value})} />
        <Stat label={t('profile.lost')} value={t(lost.i18nKey, {value: lost.value})} />
      </View>

      <Button
        label={t('settings.title')}
        variant="secondary"
        onPress={() => navigation.navigate('Settings')}
        style={styles.settingsButton}
      />
    </Screen>
  );
}

function Stat({label, value}: {label: string; value: string}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text variant="metricLabel" color="textTertiary">
        {label.toUpperCase()}
      </Text>
      <Text variant="title2">{value}</Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.lg,
  },
  colorSwatch: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.lg,
  },
  identity: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  hero: {
    marginVertical: theme.spacing.xl,
    gap: theme.spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: theme.spacing.xl,
  },
  stat: {
    // Two columns at default size; reflows to one at large font scales (NFR-10).
    minWidth: '45%',
    flexGrow: 1,
    gap: theme.spacing.xxs,
  },
  settingsButton: {
    marginTop: theme.spacing.xxl,
  },
}));
