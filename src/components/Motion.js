import React, { useState, useRef, useCallback } from 'react';
import { View } from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import { useFocusEffect } from '@react-navigation/native';
import { useHousehold } from '../context/HouseholdContext';

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

// Flatten Moti's shorthand `animate` into a plain RN style so a static View can
// show the element in its final animated state (used when motion is disabled).
function finalStyle(animate = {}) {
  const style = {};
  const transform = [];
  for (const [k, raw] of Object.entries(animate)) {
    const v = last(raw);
    if (['translateX', 'translateY', 'scale', 'rotate', 'rotateZ', 'perspective'].includes(k)) {
      transform.push({ [k]: v });
    } else {
      style[k] = v; // opacity, width, height, backgroundColor, …
    }
  }
  if (transform.length) style.transform = transform;
  return style;
}

export const useAnimationsEnabled = () => (useHousehold()?.animationsEnabled ?? true);

// Motion-aware view: a MotiView when animations are on, else a static View that
// renders the element in its final state (no entrance/exit). Drop-in for MotiView.
export function M({ from, animate, transition, exit, style, children, ...rest }) {
  if (!useAnimationsEnabled()) {
    return <View style={[style, finalStyle(animate)]} {...rest}>{children}</View>;
  }
  return (
    <MotiView from={from} animate={animate} transition={transition} exit={exit} style={style} {...rest}>
      {children}
    </MotiView>
  );
}

// AnimatePresence that no-ops (renders children directly) when motion is off.
export function Presence({ children }) {
  if (!useAnimationsEnabled()) return <>{children}</>;
  return <AnimatePresence>{children}</AnimatePresence>;
}

// Staggered entrance — springs up + fades in, delayed by index. Replays whenever
// remounted (see useEntranceReplay). Respects the reduce-motion toggle via M.
export function Rise({ index = 0, style, children }) {
  return (
    <M
      from={{ opacity: 0, translateY: 22, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 16, stiffness: 150, mass: 0.9, delay: index * 55 }}
      style={style}
    >
      {children}
    </M>
  );
}

// Like Rise but for virtualized list items: only the first `threshold` items
// animate (a one-screenful stagger); later items render static so scrolling
// doesn't re-trigger entrance animations as rows recycle.
export function RiseItem({ index = 0, threshold = 10, style, children }) {
  if (index >= threshold) return <View style={style}>{children}</View>;
  return <Rise index={index} style={style}>{children}</Rise>;
}

// Reveals its children (fade + slide + scale in) when `visible` flips true —
// for virtualized lists (FlatList) where items should animate as they scroll
// INTO view, not when they mount off-screen. Drive `visible` from the list's
// onViewableItemsChanged. Always shown when motion is disabled.
export function Reveal({ visible, delay = 0, style, children }) {
  const shown = visible || !useAnimationsEnabled();
  return (
    <M
      style={style}
      animate={{
        opacity: shown ? 1 : 0,
        translateY: shown ? 0 : 18,
        scale: shown ? 1 : 0.97,
      }}
      transition={shown
        ? { type: 'spring', damping: 16, stiffness: 160, mass: 0.9, delay }
        : { type: 'timing', duration: 0 }}
    >
      {children}
    </M>
  );
}

// Returns a key that bumps on every screen focus (skipping the first, since the
// mount already animates) so a keyed container remounts and replays its entrance
// animations. No-ops when motion is disabled. Same pattern proven on Home.
export function useEntranceReplay() {
  const animationsEnabled = useAnimationsEnabled();
  const [contentKey, setContentKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      if (animationsEnabled) setContentKey((k) => k + 1);
    }, [animationsEnabled]),
  );
  return contentKey;
}
