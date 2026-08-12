import { useCallback, useRef, useState } from 'react';
import { Animated } from 'react-native';

// Hide-on-scroll for a floating action button. Scrolling down slides the FAB
// out of the way and stops it intercepting touches, so it never blocks the
// content beneath it; scrolling up (or reaching the top) brings it back.
// Pass the screen's entrance anim (0→1 scale/opacity) to compose both, or
// null when the FAB has no entrance animation.
//
// Thresholds mirror NavScrollContext so the FAB and tab bar hide in sync.
export default function useFabHideOnScroll(enterAnim = null) {
  const hideAnim = useRef(new Animated.Value(0)).current; // 0 = shown, 1 = hidden
  const lastY = useRef(0);
  const hidden = useRef(false);
  const [interactive, setInteractive] = useState(true);

  const setHidden = useCallback((next) => {
    if (hidden.current === next) return;
    hidden.current = next;
    setInteractive(!next);
    Animated.spring(hideAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      friction: 12,
      tension: 90,
    }).start();
  }, [hideAnim]);

  const onScroll = useCallback((event) => {
    const y = event.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (Math.abs(dy) < 5) return;
    setHidden(dy > 0 && y > 50);
  }, [setHidden]);

  const hideTranslate = hideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 140] });
  const hideOpacity   = hideAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  const animatedStyle = {
    opacity: enterAnim ? Animated.multiply(enterAnim, hideOpacity) : hideOpacity,
    transform: [
      ...(enterAnim ? [{ scale: enterAnim }] : []),
      { translateY: hideTranslate },
    ],
  };

  return { onScroll, animatedStyle, pointerEvents: interactive ? 'auto' : 'none' };
}
