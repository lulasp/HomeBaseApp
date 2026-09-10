import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

const NavScrollContext = createContext(null);

const SPRING = { useNativeDriver: true, friction: 12, tension: 90 };

export const NavScrollProvider = ({ children }) => {
  const lastY = useRef(0);
  const compactAnim = useRef(new Animated.Value(0)).current;

  // Compact state is also published as a plain boolean, for the layout changes an
  // animated transform can't express. Kept in refs + subscribers rather than
  // provider state so toggling it doesn't re-render every screen.
  const isCompact = useRef(false);
  const subscribers = useRef(new Set());

  const setCompact = useCallback((next) => {
    if (isCompact.current !== next) {
      isCompact.current = next;
      subscribers.current.forEach((fn) => fn(next));
    }
    Animated.spring(compactAnim, { toValue: next ? 1 : 0, ...SPRING }).start();
  }, []);

  const handleScroll = useCallback((event) => {
    const y = event.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;

    if (Math.abs(dy) < 5) return;

    setCompact(dy > 0 && y > 50);
  }, [setCompact]);

  const resetCompact = useCallback(() => {
    lastY.current = 0;
    setCompact(false);
  }, [setCompact]);

  const subscribeCompact = useCallback((fn) => {
    subscribers.current.add(fn);
    return () => subscribers.current.delete(fn);
  }, []);

  return (
    <NavScrollContext.Provider
      value={{ handleScroll, compactAnim, resetCompact, subscribeCompact, isCompact }}
    >
      {children}
    </NavScrollContext.Provider>
  );
};

export const useNavScroll = () => useContext(NavScrollContext);

/**
 * Scroll props for a screen's main vertical scroll container, so the mobile nav
 * shrinks as you scroll down. Spread onto the ScrollView/FlatList:
 *
 *   <ScrollView {...useNavScrollProps()} />
 *
 * Also expands the nav on focus: the scroll offset is shared across screens, so
 * without this a screen inherits the previous one's offset and starts compact
 * (or computes a bogus first delta) when pushed from a scrolled list.
 */
export const useNavScrollProps = () => {
  const { handleScroll, resetCompact } = useNavScroll();

  useFocusEffect(useCallback(() => { resetCompact(); }, [resetCompact]));

  return { onScroll: handleScroll, scrollEventThrottle: 16 };
};

/**
 * Whether the nav is currently compact, as a boolean that re-renders the caller.
 * For screens whose own chrome has to shrink with the nav — a layout change,
 * which `compactAnim` (a native-driven transform) can't drive on its own.
 */
export const useNavCompact = () => {
  const { subscribeCompact, isCompact } = useNavScroll();
  const [compact, setCompactState] = useState(isCompact.current);

  useEffect(() => {
    setCompactState(isCompact.current); // in case it changed before we subscribed
    return subscribeCompact(setCompactState);
  }, [subscribeCompact, isCompact]);

  return compact;
};
