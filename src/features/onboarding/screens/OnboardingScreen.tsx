import React, {useState} from 'react';

import {Pressable, ScrollView, View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Screen, Text} from '@components/index';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {makeStyles, useTheme} from '@core/theme/ThemeProvider';
import {formatArea} from '@core/utils/format';

import {LeaderboardPreview} from '../components/LeaderboardPreview';
import {OnboardingHero} from '../components/OnboardingHero';
import {RaidDiagram} from '../components/RaidDiagram';

/**
 * Three screens explaining claim → defend → climb (doc 07 Phase 7).
 *
 * The stated target is that a new user understands the core loop in under 20
 * seconds, and doc 01 §3 measures success as ≥40% of new users completing a
 * first valid claim in session one. Three sentences is the budget; anything
 * longer is not read — so each screen carries one sentence and one picture, and
 * the picture does the explaining.
 *
 * Every route out of here lands in the same place. Skip is not a lesser path:
 * a player who already understands the game should not have to tap Next three
 * times to start playing.
 */

const STEP_COUNT = 3;

export function OnboardingScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [step, setStep] = useState(0);

  const isLast = step === STEP_COUNT - 1;

  const finish = () => {
    storage.setBoolean(StorageKeys.onboardingCompleted, true);
    navigation.navigate('SignUp');
  };

  const areaLabel = (areaM2: number) => {
    const area = formatArea(areaM2);
    return t(area.i18nKey, {value: area.value});
  };

  return (
    // No safe-area edges: the photograph on the first screen bleeds to the very
    // top of the display, so the insets are applied per-element below.
    <Screen edges={[]} bleed>
      {step === 0 ? <OnboardingHero /> : null}

      <View style={[styles.skipRow, {paddingTop: insets.top + theme.spacing.sm}]}>
        <Button
          label={t('onboarding.skip')}
          variant="ghost"
          size="medium"
          fullWidth={false}
          onPress={finish}
        />
      </View>

      {/*
        Scrollable so the diagram and four preview rows still fit at 200% font
        scaling (NFR-10). `flexGrow` keeps the single-screen layouts — copy
        pinned low on step 1, centred on steps 2 and 3 — at ordinary sizes.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, step === 0 && styles.scrollContentBottom]}
        showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <View style={styles.copy}>
            <Text variant="kicker" color="accent">
              {t('common.appName')}
            </Text>
            <Text variant="display">{t('onboarding.step1Title')}</Text>
            <Text variant="body" color="textSecondary">
              {t('onboarding.step1Body')}
            </Text>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.stepBlock}>
            <RaidDiagram
              yoursLabel={t('onboarding.diagramYours')}
              rivalLabel={t('onboarding.diagramRival')}
              accessibilityLabel={t('onboarding.diagramA11y')}
            />
            <View style={styles.copy}>
              <Text variant="display">{t('onboarding.step2Title')}</Text>
              <Text variant="body" color="textSecondary">
                {t('onboarding.step2Body')}
              </Text>
            </View>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.stepBlock}>
            <LeaderboardPreview
              youLabel={t('onboarding.previewYou')}
              formatAreaLabel={areaLabel}
            />
            <View style={styles.copy}>
              <Text variant="display">{t('onboarding.step3Title')}</Text>
              <Text variant="body" color="textSecondary">
                {t('onboarding.step3Body')}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.dots}>
        {Array.from({length: STEP_COUNT}, (_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.goToStep', {step: index + 1, total: STEP_COUNT})}
            accessibilityState={{selected: index === step}}
            // The dot is drawn at 6 px; the target around it is not.
            hitSlop={theme.spacing.md}
            onPress={() => setStep(index)}
            style={[styles.dot, index === step && styles.dotActive]}
          />
        ))}
      </View>

      <View style={[styles.actions, {paddingBottom: insets.bottom + theme.spacing.xxl}]}>
        <Button
          label={isLast ? t('onboarding.getStarted') : t('common.next')}
          style={styles.cta}
          onPress={() => (isLast ? finish() : setStep(step + 1))}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(theme => ({
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.lg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: theme.spacing.xxl,
    paddingHorizontal: 30,
  },
  scrollContentBottom: {
    // Step 1's copy sits at the foot of the photograph, not the middle of it.
    justifyContent: 'flex-end',
  },
  stepBlock: {
    gap: theme.spacing.xxl,
  },
  copy: {
    gap: theme.spacing.smd,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    paddingVertical: theme.spacing.xl,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.controlOff,
  },
  dotActive: {
    width: 20,
    backgroundColor: theme.colors.accent,
  },
  actions: {
    paddingHorizontal: theme.spacing.xl,
  },
  cta: {
    minHeight: 56,
  },
}));
