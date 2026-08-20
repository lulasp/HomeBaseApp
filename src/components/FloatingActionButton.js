import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, PanResponder, StyleSheet, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useFabPosition } from '../context/FabPositionContext';
import { useIsDesktop } from '../navigation/TabBar';
import useVisualViewportHeight from '../hooks/useVisualViewportHeight';
import { radius } from '../theme/colors';

const FAB_SIZE = 58;
const SIDE_INSET = 20;         // gap from the left/right edge
const BOTTOM_CLEARANCE = 160;  // clear the floating tab bar
const TOP_CLEARANCE = 96;      // clear the header
const DRAG_THRESHOLD = 6;      // px moved before a touch counts as a drag, not a tap

// Pixel anchor (top-left of the FAB) for each corner, in the coordinate space of
// the box the button is absolutely positioned within.
//
// This must be driven by the *container* size, not the window: host screens nest
// the FAB inside the desktop sidebar inset and centered max-width wrappers, so
// window coordinates put it hundreds of px off-screen (see FloatingActionButton
// test). `viewportHeight` only caps the vertical anchor, so the button stays
// reachable when the web keyboard shrinks the visible area.
export function computeAnchors({ boxWidth, boxHeight, viewportHeight, insetTop = 0 }) {
  const left = SIDE_INSET;
  const right = Math.max(boxWidth - SIDE_INSET - FAB_SIZE, SIDE_INSET);
  const top = insetTop + TOP_CLEARANCE;
  const usableHeight = Math.min(boxHeight, viewportHeight);
  const bottom = Math.max(usableHeight - BOTTOM_CLEARANCE - FAB_SIZE, top);
  return {
    topLeft:     { x: left,  y: top },
    topRight:    { x: right, y: top },
    bottomLeft:  { x: left,  y: bottom },
    bottomRight: { x: right, y: bottom },
  };
}

// Reusable floating "+" button. On mobile it can be dragged and snaps to the
// nearest of the four screen corners (remembered via FabPositionContext); on
// desktop it stays put. Entrance + hide-on-scroll animations are passed in from
// the host screen so the button composes with the existing behaviour.
export default function FloatingActionButton({
  onPress,
  accessibilityLabel,
  icon = 'add',
  enterAnim = null,
  hideAnim = null,
  interactive = true,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();
  const { width: windowWidth } = useWindowDimensions();
  const viewportHeight = useVisualViewportHeight();
  const fabPos = useFabPosition() || {};
  const corner = fabPos.corner || 'bottomRight';
  const setCorner = fabPos.setCorner || (() => {});

  // Size of the box this button is absolutely positioned within, measured by the
  // full-bleed layer below. Window dimensions are only the pre-measure fallback.
  const [box, setBox] = useState(null);
  const boxWidth  = box?.width  ?? windowWidth;
  const boxHeight = box?.height ?? viewportHeight;

  const anchors = useMemo(
    () => computeAnchors({ boxWidth, boxHeight, viewportHeight, insetTop: insets.top }),
    [boxWidth, boxHeight, viewportHeight, insets.top],
  );

  const anchor = anchors[corner] || anchors.bottomRight;

  const pos = useRef(new Animated.ValueXY(anchor)).current;
  const draggingRef = useRef(false);

  // Latest values for the (stable) PanResponder callbacks to read.
  const anchorsRef = useRef(anchors);
  const cornerRef = useRef(corner);
  const dimsRef = useRef({ width: boxWidth, height: boxHeight });
  const setCornerRef = useRef(setCorner);
  const canDragRef = useRef(!isDesktop);
  anchorsRef.current = anchors;
  cornerRef.current = corner;
  dimsRef.current = { width: boxWidth, height: boxHeight };
  setCornerRef.current = setCorner;
  canDragRef.current = !isDesktop;

  // Keep the button on its anchor when the anchor moves (rotation, keyboard,
  // corner change) — but never yank it mid-drag.
  const measuredRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    // The first anchor is computed from the window fallback; once the container
    // is measured, jump rather than spring so the button doesn't visibly slide
    // in from the wrong place on mount.
    if (box && !measuredRef.current) {
      measuredRef.current = true;
      pos.setValue(anchor);
      return;
    }
    Animated.spring(pos, {
      toValue: anchor, useNativeDriver: false, friction: 9, tension: 90,
    }).start();
  }, [anchor.x, anchor.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        canDragRef.current &&
        (Math.abs(gs.dx) > DRAG_THRESHOLD || Math.abs(gs.dy) > DRAG_THRESHOLD),
      onPanResponderGrant: () => { draggingRef.current = true; },
      onPanResponderMove: (_, gs) => {
        const a = anchorsRef.current[cornerRef.current];
        pos.setValue({ x: a.x + gs.dx, y: a.y + gs.dy });
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, gs) => {
        draggingRef.current = false;
        const { width: W, height: H } = dimsRef.current;
        // Snap by where the button ended up *inside its container*. gs.moveX/Y
        // are page coordinates, which no longer line up with the container once
        // it's inset or centered — derive from the anchor plus the drag delta.
        const a = anchorsRef.current[cornerRef.current];
        const centerX = a.x + gs.dx + FAB_SIZE / 2;
        const centerY = a.y + gs.dy + FAB_SIZE / 2;
        const horiz = centerX < W / 2 ? 'Left' : 'Right';
        const vert = centerY < H / 2 ? 'top' : 'bottom';
        const next = `${vert}${horiz}`; // e.g. topLeft, bottomRight
        setCornerRef.current(next);
        Animated.spring(pos, {
          toValue: anchorsRef.current[next], useNativeDriver: false,
          friction: 8, tension: 80,
        }).start();
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        Animated.spring(pos, {
          toValue: anchorsRef.current[cornerRef.current], useNativeDriver: false,
          friction: 8, tension: 80,
        }).start();
      },
    }),
  ).current;

  // Entrance (scale/opacity 0→1) composed with hide-on-scroll (fade + shrink).
  const hideOpacity = hideAnim
    ? hideAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
    : 1;
  const hideScale = hideAnim
    ? hideAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] })
    : 1;
  const opacity = enterAnim ? Animated.multiply(enterAnim, hideOpacity) : hideOpacity;
  const scale = Animated.multiply(enterAnim || 1, hideScale);

  return (
    // Full-bleed layer: stretches to the containing block so onLayout reports
    // the box the FAB is actually positioned within. box-none lets touches fall
    // through to the list underneath.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setBox((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}
    >
      <Animated.View
        style={[styles.base, { transform: pos.getTranslateTransform() }]}
        pointerEvents={interactive ? 'auto' : 'none'}
        {...(isDesktop ? {} : panResponder.panHandlers)}
      >
        <Animated.View style={{ opacity, transform: [{ scale }] }}>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent, shadowColor: colors.accent }]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
          >
            <Ionicons name={icon} size={28} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute', top: 0, left: 0,
    width: FAB_SIZE, height: FAB_SIZE,
  },
  button: {
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
});
