import React from 'react';

import {View} from 'react-native';

import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {Button, Loader, Screen, Text} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {makeStyles} from '@core/theme/ThemeProvider';
import type {RootStackParamList} from '@navigation/types';

import {fetchParcelDetail} from '../api/mapApi';

/**
 * The parcel tap sheet (FR-52).
 *
 * Shows owner, area, claimed date and protection status — and nothing else.
 * No route, no walk history, no "last seen": doc 06 §4.1 is explicit that only
 * finished, simplified parcel polygons are public.
 *
 * The protection line is what competitive players actually come here for
 * (FR-41) — it tells them whether walking this ground would be wasted.
 */
export function ParcelDetailScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ParcelDetail'>>();

  const {data, isLoading} = useQuery({
    queryKey: queryKeys.parcels.detail(route.params.parcelId),
    queryFn: () => fetchParcelDetail(route.params.parcelId),
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <Screen>
        <Loader label={t('common.loading')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.swatch, {backgroundColor: data.colorHex}]} />
          <Text variant="title2">
            {data.isMine
              ? t('parcel.ownedByYou')
              : t('parcel.ownedBy', {username: data.ownerUsername})}
          </Text>
        </View>

        <Field label={t('parcel.area')} value={data.areaDisplay} />
        <Field label={t('parcel.claimed')} value={new Date(data.claimedAt).toLocaleDateString()} />
        <Field
          label={t('parcel.protectedBadge')}
          value={
            data.isProtected && data.protectedUntil
              ? t('parcel.protectedUntil', {
                  time: new Date(data.protectedUntil).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })
              : t('parcel.notProtected')
          }
        />

        {!data.isMine ? (
          <Button
            label={t('parcel.viewProfile')}
            variant="secondary"
            onPress={() => navigation.navigate('PublicProfile', {username: data.ownerUsername})}
            style={styles.action}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function Field({label, value}: {label: string; value: string}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text variant="metricLabel" color="textTertiary">
        {label.toUpperCase()}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  content: {
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.sm,
  },
  field: {
    gap: theme.spacing.xxs,
  },
  action: {
    marginTop: theme.spacing.lg,
  },
}));
