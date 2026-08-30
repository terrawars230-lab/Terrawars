import React, {useState} from 'react';

import {View} from 'react-native';

import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {Button, Screen, Text} from '@components/index';
import {DEFAULT_GAME_CONFIG} from '@core/constants/gameConfig';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {makeStyles} from '@core/theme/ThemeProvider';

/**
 * Three screens explaining walk → loop → own it (doc 07 Phase 7).
 *
 * The stated target is that a new user understands the core loop in under 20
 * seconds, and doc 01 §3 measures success as ≥40% of new users completing a
 * first valid claim in session one. Three sentences is the budget; anything
 * longer is not read.
 */
export function OnboardingScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const styles = useStyles();
  const navigation = useNavigation();
  const [step, setStep] = useState(0);

  const steps = [
    {title: t('onboarding.step1Title'), body: t('onboarding.step1Body')},
    {title: t('onboarding.step2Title'), body: t('onboarding.step2Body')},
    {
      title: t('onboarding.step3Title'),
      body: t('onboarding.step3Body', {hours: DEFAULT_GAME_CONFIG.protectionHours}),
    },
  ];

  const isLast = step === steps.length - 1;

  const finish = () => {
    storage.setBoolean(StorageKeys.onboardingCompleted, true);
    navigation.navigate('SignUp');
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="display">{steps[step]!.title}</Text>
        <Text variant="body" color="textSecondary">
          {steps[step]!.body}
        </Text>
      </View>

      <View style={styles.dots} accessibilityRole="progressbar">
        {steps.map((_, index) => (
          <View key={index} style={[styles.dot, index === step && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.actions}>
        <Button
          label={isLast ? t('onboarding.getStarted') : t('common.next')}
          onPress={() => (isLast ? finish() : setStep(step + 1))}
        />
        <Button label={t('onboarding.skip')} variant="ghost" onPress={finish} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(theme => ({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
  },
  dotActive: {
    backgroundColor: theme.colors.accent,
    width: 24,
  },
  actions: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
}));
