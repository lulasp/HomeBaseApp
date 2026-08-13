import { useCallback, useRef, useState } from 'react';
import { Animated } from 'react-native';

// Hide-on-scroll signal for a floating action button. Scrolling down drives
// `hideAnim` toward 1 (fade/shrink the FAB away) and flips `interactive` off so
// it stops intercepting touches; scrolling up (or reaching the top) brings it
// back. Consumed by <FloatingActionButton>, which owns the actual styling.
//
// Thresholds mirror NavScrollContext so the FAB and tab bar hide in sync.
export default function useFabHideOnScroll() {
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

  return { onScroll, hideAnim, interactive };
}
