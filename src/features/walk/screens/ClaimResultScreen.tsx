import React from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {Button, Loader, Screen, Text} from '@components/index';
import {supabase} from '@core/api/supabase/client';
import {errorMessageKey} from '@core/constants/errorCodes';
import {makeStyles} from '@core/theme/ThemeProvider';
import {formatArea, formatDistance, formatDuration} from '@core/utils/format';
import type {RootStackParamList} from '@navigation/types';

/**
 * The post-claim screen (FR-31, FR-34, doc 03 §6).
 *
 * Two rules shape this screen:
 *
 *  1. **A rejection is not an error.** doc 05 §7 calls a 422 a normal outcome.
 *     There is no red banner and no "something went wrong" — just the plain
 *     reason and what to do differently.
 *  2. **The walk is always shown.** doc 03 §6: "In every rejection case, still
 *     save the walk with its distance and duration. The user did the exercise;
 *     do not throw that away." The distance line renders in both branches.
 *
 * The result is re-read from the server by claim id rather than passed through
 * navigation params, so an app that was backgrounded and restored shows the
 * real outcome rather than a stale snapshot.
 */
export function ClaimResultScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ClaimResult'>>();
  const {claimId} = route.params;

  const {data, isLoading} = useQuery({
    queryKey: ['claim', claimId],
    queryFn: async () => {
      const {data: claim, error} = await supabase
        .from('claims')
        .select('status, error_code, raw_area_m2, net_area_gain_m2, stolen_area_m2, walk_id')
        .eq('id', claimId)
        .single();

      if (error) {
        throw error;
      }
      return claim;
    },
    enabled: claimId.length > 0,
    // The claim is immutable once written, so it never needs refetching.
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (isLoading) {
    return (
      <Screen>
        <Loader label={t('walk.submitting')} />
      </Screen>
    );
  }

  const isAccepted = data?.status === 'accepted';
  const gained = formatArea(data?.net_area_gain_m2 ?? 0);
  const stolen = formatArea(data?.stolen_area_m2 ?? 0);

  return (
    <Screen scrollable>
      <View style={styles.content}>
        <Text variant="display" align="center">
          {isAccepted ? t('claimResult.acceptedTitle') : t('claimResult.rejectedTitle')}
        </Text>

        {isAccepted ? (
          <>
            <View style={styles.hero}>
              <Text variant="metricLabel" color="textTertiary" align="center">
                {t('claimResult.areaGained').toUpperCase()}
              </Text>
              <Text variant="display" color="accent" align="center">
                {t(gained.i18nKey, {value: gained.value})}
              </Text>
            </View>

            {(data?.stolen_area_m2 ?? 0) > 0 ? (
              <Text variant="body" color="textSecondary" align="center">
                {t('claimResult.areaStolen')}: {t(stolen.i18nKey, {value: stolen.value})}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="body" color="textSecondary" align="center">
            {t(errorMessageKey(data?.error_code ?? 'UNKNOWN'))}
          </Text>
        )}

        {/* doc 03 §6: the exercise is saved either way, and the user is told so. */}
        <WalkFooter walkId={data?.walk_id} />
      </View>

      <Button
        label={t('claimResult.backToMap')}
        onPress={() => navigation.navigate('MainTabs', {screen: 'MapTab', params: {}})}
        style={styles.action}
      />
    </Screen>
  );
}

function WalkFooter({walkId}: {walkId?: string}): React.JSX.Element | null {
  const {t} = useTranslation();
  const styles = useStyles();

  const {data} = useQuery({
    queryKey: ['walk-summary', walkId],
    queryFn: async () => {
      const {data: walk, error} = await supabase
        .from('walks')
        .select('distance_m, duration_s')
        .eq('id', walkId!)
        .single();

      if (error) {
        throw error;
      }
      return walk;
    },
    enabled: Boolean(walkId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!data) {
    return null;
  }

  const distance = formatDistance(data.distance_m ?? 0);
  const duration = formatDuration(data.duration_s ?? 0);

  return (
    <Text variant="caption" color="textTertiary" align="center" style={styles.walkFooter}>
      {t('claimResult.walkStillSaved', {
        distance: t(distance.i18nKey, {value: distance.value}),
        duration: t(duration.i18nKey, duration.params),
      })}
    </Text>
  );
}

const useStyles = makeStyles(theme => ({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
  },
  hero: {
    gap: theme.spacing.xs,
    marginVertical: theme.spacing.lg,
  },
  walkFooter: {
    marginTop: theme.spacing.xl,
  },
  action: {
    marginBottom: theme.spacing.lg,
  },
}));
