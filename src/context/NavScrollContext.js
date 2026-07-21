import React, { createContext, useContext, useRef, useCallback } from 'react';
import { Animated } from 'react-native';

const NavScrollContext = createContext(null);

export const NavScrollProvider = ({ children }) => {
  const lastY = useRef(0);
  const compactAnim = useRef(new Animated.Value(0)).current;

  const handleScroll = useCallback((event) => {
    const y = event.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;

    if (Math.abs(dy) < 5) return;

    Animated.spring(compactAnim, {
      toValue: dy > 0 && y > 50 ? 1 : 0,
      useNativeDriver: true,
      friction: 12,
      tension: 90,
    }).start();
  }, []);

  const resetCompact = useCallback(() => {
    lastY.current = 0;
    Animated.spring(compactAnim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 12,
      tension: 90,
    }).start();
  }, []);

  return (
    <NavScrollContext.Provider value={{ handleScroll, compactAnim, resetCompact }}>
      {children}
    </NavScrollContext.Provider>
  );
};

export const useNavScroll = () => useContext(NavScrollContext);
