import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {
  Animated,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

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
 * The steps auto-advance and can also be swiped. The first touch stops the
 * timer for good — a carousel that keeps moving under the finger fights the
 * user. Next and the dots drive the same pager, so there is one source of
 * truth for which step is showing.
 *
 * Every route out of here lands in the same place. Skip is not a lesser path:
 * a player who already understands the game should not have to swipe through
 * three screens to start playing.
 */

const STEP_COUNT = 3;

/** How far the photograph drifts as step 1 leaves, as a fraction of the width. */
const HERO_PARALLAX = 0.35;

/** Long enough to read one sentence and look at the picture. */
const AUTO_ADVANCE_MS = 4500;

export function OnboardingScreen(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const {width} = useWindowDimensions();

  // `ScrollView` is a function component in RN 0.87, so its ref is the public
  // instance type rather than the component class — derived here rather than
  // imported because React Native does not export it.
  const pagerRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [step, setStep] = useState(0);

  // Set on the first touch, never cleared: auto-advance is for a user who is
  // not driving, and one who is must not be interrupted.
  const [isPaused, setIsPaused] = useState(false);

  // Native-driven so the photograph tracks the finger rather than lagging a
  // frame behind it on the JS thread.
  const scrollX = useRef(new Animated.Value(0)).current;
  const handleScroll = useMemo(
    () => Animated.event([{nativeEvent: {contentOffset: {x: scrollX}}}], {useNativeDriver: true}),
    [scrollX],
  );

  const isLast = step === STEP_COUNT - 1;

  const goToStep = useCallback(
    (index: number) => {
      // Sets the state as well as scrolling: `onMomentumScrollEnd` does not
      // fire for a programmatic scroll on every platform, so the dots would
      // otherwise keep pointing at the step the user just left.
      setStep(index);
      pagerRef.current?.scrollTo({x: index * width, animated: true});
    },
    [width],
  );

  // Stops on the last step rather than looping: the CTA there is the point of
  // the screen, and sliding away from it costs a signup.
  useEffect(() => {
    if (isPaused || step >= STEP_COUNT - 1) {
      return;
    }
    const timer = setTimeout(() => goToStep(step + 1), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [goToStep, isPaused, step]);

  // Read through a ref so the re-anchor below runs on a width change only —
  // depending on `step` would fight every swipe with a second scrollTo.
  const stepRef = useRef(step);
  stepRef.current = step;

  // A rotation changes the page width under a content offset measured in the
  // old one, which leaves the pager parked between two steps. Re-anchor it to
  // whichever step was showing.
  useEffect(() => {
    pagerRef.current?.scrollTo({x: stepRef.current * width, animated: false});
  }, [width]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setStep(Math.round(event.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  const finish = () => {
    storage.setBoolean(StorageKeys.onboardingCompleted, true);
    navigation.navigate('SignUp');
  };

  const areaLabel = (areaM2: number) => {
    const area = formatArea(areaM2);
    return t(area.i18nKey, {value: area.value});
  };

  const renderStep = (index: number): React.JSX.Element => {
    if (index === 0) {
      return (
        <View style={styles.copy}>
          <Text variant="kicker" color="accent">
            {t('common.appName')}
          </Text>
          <Text variant="display">{t('onboarding.step1Title')}</Text>
          <Text variant="body" color="textSecondary">
            {t('onboarding.step1Body')}
          </Text>
        </View>
      );
    }

    if (index === 1) {
      return (
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
      );
    }

    return (
      <View style={styles.stepBlock}>
        <LeaderboardPreview youLabel={t('onboarding.previewYou')} formatAreaLabel={areaLabel} />
        <View style={styles.copy}>
          <Text variant="display">{t('onboarding.step3Title')}</Text>
          <Text variant="body" color="textSecondary">
            {t('onboarding.step3Body')}
          </Text>
        </View>
      </View>
    );
  };

  return (
    // No safe-area edges: the photograph on the first screen bleeds to the very
    // top of the display, so the insets are applied per-element below.
    <Screen edges={[]} bleed>
      {/*
        The hero stays mounted at screen level rather than riding inside page 1.
        Inside the pager its `top: 0` would be the top of the pager — below the
        skip row — and the photograph would stop bleeding to the top of the
        display. Fading and drifting it against the scroll offset keeps the
        design and still ties it to the gesture.
      */}
      <Animated.View
        pointerEvents="none"
        // Absolutely filling the screen, not a zero-height flow child: the hero
        // positions its photograph absolutely at `top: 0` with its own height,
        // and an ancestor of height 0 leaves that overflowing — which Android
        // is free to clip.
        style={{
          ...({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0} as const),
          opacity: scrollX.interpolate({
            inputRange: [0, width],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              translateX: scrollX.interpolate({
                inputRange: [0, width],
                outputRange: [0, -width * HERO_PARALLAX],
                extrapolate: 'clamp',
              }),
            },
          ],
        }}>
        <OnboardingHero />
      </Animated.View>

      <View style={[styles.skipRow, {paddingTop: insets.top + theme.spacing.sm}]}>
        <Button
          label={t('onboarding.skip')}
          variant="ghost"
          size="medium"
          fullWidth={false}
          onPress={finish}
        />
      </View>

      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onScrollBeginDrag={() => setIsPaused(true)}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
        style={styles.pager}>
        {Array.from({length: STEP_COUNT}, (_, index) => (
          /*
            Each page scrolls vertically inside the horizontal one, so the
            diagram and the four preview rows still fit at 200% font scaling
            (NFR-10). `flexGrow` keeps the single-screen layouts — copy pinned
            low on step 1, centred on steps 2 and 3 — at ordinary sizes.
          */
          <View key={index} style={[styles.page, {width}]}>
            <ScrollView
              contentContainerStyle={[styles.pageContent, index === 0 && styles.pageContentBottom]}
              showsVerticalScrollIndicator={false}>
              {renderStep(index)}
            </ScrollView>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.dots}>
        {Array.from({length: STEP_COUNT}, (_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.goToStep', {step: index + 1, total: STEP_COUNT})}
            accessibilityState={{selected: index === step}}
            onPress={() => {
              setIsPaused(true);
              goToStep(index);
            }}
            // The target is padding, NOT hitSlop. The dots sit 7 px apart, so
            // any hitSlop wide enough to be worth having overlaps its
            // neighbour's — and an overlapping slop resolves to whichever dot
            // rendered last, which means a tap aimed at step 2 silently opens
            // step 3. Padding of half the gap makes the targets tile exactly:
            // adjacent, never overlapping, each one unambiguous.
            style={styles.dotTarget}>
            <View style={[styles.dot, index === step && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      <View style={[styles.actions, {paddingBottom: insets.bottom + theme.spacing.xxl}]}>
        <Button
          label={isLast ? t('onboarding.getStarted') : t('common.next')}
          style={styles.cta}
          onPress={() => {
            setIsPaused(true);
            return isLast ? finish() : goToStep(step + 1);
          }}
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
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: theme.spacing.xxl,
    paddingHorizontal: 30,
  },
  pageContentBottom: {
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
    // No `gap`: the spacing is each target's own padding, so the gap the eye
    // sees is inside the tappable area rather than dead space between two.
    paddingVertical: theme.spacing.sm,
  },
  dotTarget: {
    // Half the design's 7 px gap on each side, and enough height to clear the
    // 44 px the rest of the HUD's secondary controls use.
    paddingHorizontal: 3.5,
    paddingVertical: theme.spacing.lg,
    justifyContent: 'center',
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
