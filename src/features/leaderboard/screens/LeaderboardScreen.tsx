import React, {useState} from 'react';

import {FlatList, Pressable, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {EmptyState, Loader, Screen, Text} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import {formatArea} from '@core/utils/format';

import {
  fetchLeaderboard,
  type LeaderboardEntry,
  type LeaderboardScope,
} from '../api/leaderboardApi';

/**
 * The three leaderboards (FR-60, FR-61, FR-62).
 *
 * FR-63 is the interesting requirement: the user's own rank is always visible,
 * even outside the top 100. It renders as a pinned footer row rather than being
 * hunted for in the list, because a competitive player checks their own rank
 * far more often than they read the top ten.
 */
export function LeaderboardScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const [scope, setScope] = useState<LeaderboardScope>('global');

  const {data, isLoading, isError, refetch, isRefetching} = useQuery({
    queryKey:
      scope === 'global'
        ? queryKeys.leaderboards.global()
        : scope === 'weekly'
        ? queryKeys.leaderboards.weekly()
        : queryKeys.leaderboards.local(''),
    queryFn: () => fetchLeaderboard(scope),
    staleTime: 60_000,
  });

  return (
    <Screen>
      <Text variant="title1" style={styles.title}>
        {t('leaderboard.title')}
      </Text>

      <View style={styles.tabs} accessibilityRole="tablist">
        <ScopeTab
          label={t('leaderboard.global')}
          active={scope === 'global'}
          onPress={() => setScope('global')}
        />
        <ScopeTab
          label={t('leaderboard.weekly')}
          active={scope === 'weekly'}
          onPress={() => setScope('weekly')}
        />
      </View>

      {isLoading ? (
        <Loader label={t('common.loading')} />
      ) : isError ? (
        <EmptyState
          title={t('common.somethingWentWrong')}
          actionLabel={t('common.retry')}
          onAction={() => {
            void refetch();
          }}
        />
      ) : (
        <FlatList
          data={data?.entries ?? []}
          keyExtractor={entry => entry.userId}
          renderItem={({item}) => <LeaderboardRow entry={item} />}
          refreshing={isRefetching}
          onRefresh={() => {
            void refetch();
          }}
          // NFR-03 territory: a leaderboard is 100 rows of fixed height, so
          // telling FlatList the height up front removes the measurement pass.
          getItemLayout={(_, index) => ({length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index})}
          ListEmptyComponent={
            <EmptyState title={t('leaderboard.emptyTitle')} body={t('leaderboard.emptyBody')} />
          }
          contentContainerStyle={styles.list}
        />
      )}

      {/* FR-63: always visible, whatever page is on screen. */}
      <View style={styles.meBar}>
        <Text variant="bodyStrong" color="onAccent">
          {data?.me ? t('leaderboard.yourRank', {rank: data.me.rank}) : t('leaderboard.unranked')}
        </Text>
        {data?.me ? <AreaText areaM2={data.me.valueM2} color="onAccent" /> : null}
      </View>
    </Screen>
  );
}

const ROW_HEIGHT = 56;

function ScopeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}>
      <Text variant="bodyStrong" color={active ? 'accent' : 'textSecondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

function LeaderboardRow({entry}: {entry: LeaderboardEntry}): React.JSX.Element {
  const styles = useStyles();
  const navigation = useNavigation();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => navigation.navigate('PublicProfile', {username: entry.username})}
      style={styles.row}>
      <Text variant="bodyStrong" color="textTertiary" style={styles.rank}>
        {entry.rank}
      </Text>
      <View style={[styles.colorDot, {backgroundColor: entry.colorHex}]} />
      <Text variant="body" style={styles.username} numberOfLines={1}>
        {entry.username}
      </Text>
      <AreaText areaM2={entry.valueM2} />
    </Pressable>
  );
}

function AreaText({
  areaM2,
  color = 'textSecondary',
}: {
  areaM2: number;
  color?: 'textSecondary' | 'onAccent';
}): React.JSX.Element {
  const {t} = useTranslation();
  const area = formatArea(areaM2);
  return (
    <Text variant="bodyStrong" color={color}>
      {t(area.i18nKey, {value: area.value})}
    </Text>
  );
}

const useStyles = makeStyles(theme => ({
  title: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  tab: {
    minHeight: theme.layout.minTouchTarget,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  list: {
    paddingBottom: theme.spacing.xxxl,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  rank: {
    minWidth: 32,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: theme.radius.pill,
  },
  username: {
    flex: 1,
  },
  meBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    minHeight: theme.layout.minTouchTarget,
    marginBottom: theme.spacing.md,
  },
}));
