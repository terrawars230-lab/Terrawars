import React, {useEffect, useRef, useState, type PropsWithChildren} from 'react';

import {AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle} from 'react-native';

export interface PulseProps extends PropsWithChildren {
  /** One full breath, in ms. Nocturne uses 1.8–3 s depending on the element. */
  durationMs: number;
  /** Staggers a group so several pulses do not beat in unison. */
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Nocturne's ambient pulse: opacity .55 → 1 with a 1 → 1.12 scale.
 *
 * Used for the halo on your own marker and the glow behind the Start Walk CTA —
 * decorative motion whose job is to say "live", so it is purely presentational
 * and never wraps anything interactive.
 *
 * Two things it does that a bare `Animated.loop` does not:
 *
 *  - it honours Reduce Motion. An animation that runs for the life of the map
 *    screen is exactly the kind the setting exists for, and the elements still
 *    read correctly held at their bright end;
 *  - it stops on unmount. A loop left running keeps the JS driver's timer alive
 *    and, on a screen the user returns to repeatedly, stacks.
 */
export function Pulse({durationMs, delayMs = 0, style, children}: PulseProps): React.JSX.Element {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Held bright rather than mid-fade: a static element at 55% opacity looks
      // disabled, which is the opposite of what the pulse is signalling.
      progress.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: durationMs / 2,
          delay: delayMs,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: durationMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [delayMs, durationMs, progress, reduceMotion]);

  return (
    <Animated.View
      // Decorative: the CTA underneath carries the meaning and the label.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        style,
        {
          opacity: progress.interpolate({inputRange: [0, 1], outputRange: [0.55, 1]}),
          transform: [
            {scale: progress.interpolate({inputRange: [0, 1], outputRange: [1, 1.12]})},
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
