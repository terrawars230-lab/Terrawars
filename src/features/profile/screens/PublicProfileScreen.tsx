import React from 'react';

import {View} from 'react-native';

import {useRoute, type RouteProp} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {EmptyState, Loader, Screen, Text} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import {formatArea} from '@core/utils/format';
import type {RootStackParamList} from '@navigation/types';

import {fetchPublicProfile} from '../api/profileApi';

/**
 * Another player's public profile (FR-05).
 *
 * Public fields only. This screen has no code path that could render a walk, a
 * path or a start point, and that is by design: doc 06 §4.1 makes routes
 * private, and doc 05 §5 says this endpoint never returns them. The server
 * enforces it in `get_public_profile`; this screen simply has nothing else to
 * show.
 */
export function PublicProfileScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const route = useRoute<RouteProp<RootStackParamList, 'PublicProfile'>>();
  const {username} = route.params;

  const {data, isLoading} = useQuery({
    queryKey: queryKeys.profile.byUsername(username),
    queryFn: () => fetchPublicProfile(username),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <EmptyState title={t('errors.NOT_FOUND')} />
      </Screen>
    );
  }

  const totalArea = formatArea(data.stats.totalAreaM2);
  const stolen = formatArea(data.stats.areaStolenM2);
  const lost = formatArea(data.stats.areaLostM2);

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <View style={[styles.swatch, {backgroundColor: data.colorHex}]} />
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
        <Text variant="display">{t(totalArea.i18nKey, {value: totalArea.value})}</Text>
        <Text variant="caption" color="textSecondary">
          {t('leaderboard.yourRank', {rank: data.stats.rankGlobal})}
        </Text>
      </View>

      <View style={styles.grid}>
        <Stat label={t('profile.parcels')} value={String(data.stats.parcelsCount)} />
        <Stat label={t('profile.walks')} value={String(data.stats.walksCount)} />
        <Stat label={t('profile.stolen')} value={t(stolen.i18nKey, {value: stolen.value})} />
        <Stat label={t('profile.lost')} value={t(lost.i18nKey, {value: lost.value})} />
      </View>
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
  swatch: {
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
    minWidth: '45%',
    flexGrow: 1,
    gap: theme.spacing.xxs,
  },
}));
