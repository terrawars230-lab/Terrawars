import React from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {Button, EmptyState, Loader, Screen, Text} from '@components/index';
import {toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
import {errorMessageKey} from '@core/constants/errorCodes';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import {formatArea, formatDistance, formatDuration} from '@core/utils/format';
import {cachedGameConfig} from '@features/settings/api/gameConfigApi';
import type {ClaimSummary, RootStackParamList} from '@navigation/types';

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
 * The result is re-read from the server by claim id, so an app that was
 * backgrounded and restored shows the real outcome. The verdict carried in the
 * route is the fallback — for a rejection with no claim id, or a re-read that
 * fails — so a failed fetch can never be shown as a rejected claim.
 */
export function ClaimResultScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ClaimResult'>>();
  const {claimId, summary: fallback} = route.params;

  const {data, isLoading, isError, refetch} = useQuery({
    queryKey: queryKeys.claims.detail(claimId ?? 'none'),
    queryFn: () => fetchClaimSummary(claimId!),
    enabled: claimId !== null && claimId.length > 0,
    // The claim is immutable once written, so it never needs refetching.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const summary = data ?? fallback;

  if (!summary) {
    if (isLoading) {
      return (
        <Screen>
          <Loader label={t('walk.submitting')} />
        </Screen>
      );
    }

    return (
      <Screen>
        <EmptyState
          title={t('claimResult.loadFailedTitle')}
          body={t('claimResult.loadFailedBody')}
          actionLabel={isError ? t('common.retry') : undefined}
          onAction={
            isError
              ? () => {
                  void refetch();
                }
              : undefined
          }
        />
        <BackToMap />
      </Screen>
    );
  }

  const isAccepted = summary.status === 'accepted';
  const gained = formatArea(summary.netAreaGainM2);
  const stolen = formatArea(summary.stolenAreaM2);

  return (
    <Screen scrollable>
      <View style={styles.content}>
        <Text variant="display" align="center" accessibilityRole="header">
          {isAccepted ? t('claimResult.acceptedTitle') : t('claimResult.rejectedTitle')}
        </Text>

        {isAccepted ? (
          <>
            <View style={styles.hero}>
              <Text variant="metricLabel" color="textTertiary" align="center">
                {t('claimResult.areaGained')}
              </Text>
              <Text variant="display" color="accent" align="center">
                {t(gained.i18nKey, {value: gained.value})}
              </Text>
            </View>

            {summary.stolenAreaM2 > 0 ? (
              <Text variant="body" color="textSecondary" align="center">
                {t('claimResult.areaStolenLine', {area: t(stolen.i18nKey, {value: stolen.value})})}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="body" color="textSecondary" align="center">
            {rejectionMessage(t, summary.errorCode)}
          </Text>
        )}

        {/* doc 03 §6: the exercise is saved either way, and the user is told so. */}
        <WalkLine distanceM={summary.distanceM} durationS={summary.durationS} />
      </View>

      <View style={styles.action}>
        <Button
          label={t('claimResult.backToMap')}
          onPress={() => navigation.navigate('MainTabs', {screen: 'MapTab', params: {}})}
        />
      </View>
    </Screen>
  );
}

function BackToMap(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  return (
    <View style={styles.action}>
      <Button
        label={t('claimResult.backToMap')}
        variant="secondary"
        onPress={() => navigation.navigate('MainTabs', {screen: 'MapTab', params: {}})}
      />
    </View>
  );
}

/**
 * The rejection copy, with the rule's actual threshold filled in.
 *
 * "You need to walk at least {{distance}}" rendered its placeholder verbatim
 * before this, because nothing passed the value. The thresholds come from the
 * cached `game_config` (CLAUDE.md rule 7), the same numbers the server judged
 * against.
 */
function rejectionMessage(
  t: (key: string, params?: Record<string, unknown>) => string,
  errorCode: string | null,
): string {
  // GR-24's daily cap comes back as the generic RATE_LIMITED code, whose
  // shared copy is about retrying — wrong for a limit that resets tomorrow.
  if (errorCode === 'RATE_LIMITED') {
    return t('claimResult.dailyLimit');
  }

  const config = cachedGameConfig();
  const minDistance = formatDistance(config.minWalkDistanceM);
  const minDuration = formatDuration(config.minWalkDurationS);

  return t(errorMessageKey(errorCode ?? 'UNKNOWN'), {
    distance: t(minDistance.i18nKey, {value: minDistance.value}),
    duration: t(minDuration.i18nKey, minDuration.params),
  });
}

function WalkLine({distanceM, durationS}: {distanceM: number; durationS: number}) {
  const {t} = useTranslation();
  const styles = useStyles();

  const distance = formatDistance(distanceM);
  const duration = formatDuration(durationS);

  return (
    <Text variant="caption" color="textTertiary" align="center" style={styles.walkFooter}>
      {t('claimResult.walkStillSaved', {
        distance: t(distance.i18nKey, {value: distance.value}),
        duration: t(duration.i18nKey, duration.params),
      })}
    </Text>
  );
}

/** Own claims are readable under RLS (`claims_select_own`), and so is the walk. */
async function fetchClaimSummary(claimId: string): Promise<ClaimSummary> {
  const {data: claim, error} = await supabase
    .from('claims')
    .select('status, error_code, net_area_gain_m2, stolen_area_m2, walk_id')
    .eq('id', claimId)
    .single();

  if (error) {
    throw toApiError(error, 'Could not load the claim');
  }

  const {data: walk, error: walkError} = await supabase
    .from('walks')
    .select('distance_m, duration_s')
    .eq('id', claim.walk_id)
    .single();

  if (walkError) {
    throw toApiError(walkError, 'Could not load the walk');
  }

  return {
    status: claim.status === 'accepted' ? 'accepted' : 'rejected',
    errorCode: claim.error_code,
    netAreaGainM2: Number(claim.net_area_gain_m2 ?? 0),
    stolenAreaM2: Number(claim.stolen_area_m2 ?? 0),
    distanceM: Number(walk.distance_m ?? 0),
    durationS: Number(walk.duration_s ?? 0),
  };
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
