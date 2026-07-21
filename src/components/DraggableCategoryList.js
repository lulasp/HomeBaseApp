import React, { useCallback, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export const DRAG_ITEM_HEIGHT = 50;

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export default function DraggableCategoryList({ items, renderItem, onReorder, scrollRef }) {
  const { colors } = useTheme();

  const [activeIndex, setActiveIndex] = useState(-1);

  // Animated values — one translateY for the dragged row, one shift per row
  const dragTranslate = useRef(new Animated.Value(0)).current;
  const shiftValues   = useRef([]);

  // Grow the shift array if items were added
  while (shiftValues.current.length < items.length) {
    shiftValues.current.push(new Animated.Value(0));
  }

  // Mutable drag state kept in refs so PanResponder callbacks never go stale
  const fromRef   = useRef(-1);
  const toRef     = useRef(-1);
  const lenRef    = useRef(items.length);
  lenRef.current  = items.length;

  // onReorder ref so PanResponder closure always calls the latest version
  const onReorderRef   = useRef(onReorder);
  onReorderRef.current = onReorder;

  const animateShifts = useCallback((from, to) => {
    shiftValues.current.forEach((sv, i) => {
      if (i === from) return;
      let target = 0;
      if (from < to && i > from && i <= to) target = -DRAG_ITEM_HEIGHT;
      if (from > to && i < from && i >= to) target = DRAG_ITEM_HEIGHT;
      Animated.spring(sv, {
        toValue: target,
        useNativeDriver: true,
        speed: 30,
        bounciness: 0,
      }).start();
    });
  }, []);

  const resetAll = useCallback(() => {
    shiftValues.current.forEach(sv => sv.setValue(0));
    dragTranslate.setValue(0);
    setActiveIndex(-1);
    fromRef.current = -1;
    toRef.current   = -1;
    // Re-enable outer scroll
    scrollRef?.current?.setNativeProps?.({ scrollEnabled: true });
  }, [dragTranslate, scrollRef]);

  // One PanResponder per list position, created lazily and cached
  const panResponders = useRef([]);

  items.forEach((_, idx) => {
    if (panResponders.current[idx]) return;

    panResponders.current[idx] = PanResponder.create({
      onStartShouldSetPanResponder:        () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder:         () => true,
      onMoveShouldSetPanResponderCapture:  () => true,

      onPanResponderGrant: () => {
        fromRef.current = idx;
        toRef.current   = idx;
        dragTranslate.setValue(0);
        setActiveIndex(idx);
        // Disable outer scroll so the list doesn't scroll while dragging
        scrollRef?.current?.setNativeProps?.({ scrollEnabled: false });
      },

      onPanResponderMove: (_, gs) => {
        dragTranslate.setValue(gs.dy);
        const newTo = clamp(
          idx + Math.round(gs.dy / DRAG_ITEM_HEIGHT),
          0,
          lenRef.current - 1,
        );
        if (newTo === toRef.current) return;
        toRef.current = newTo;
        animateShifts(idx, newTo);
      },

      onPanResponderRelease: () => {
        const from = fromRef.current;
        const to   = toRef.current;
        resetAll();
        if (from >= 0 && from !== to) onReorderRef.current(from, to);
      },

      onPanResponderTerminate: resetAll,
    });
  });

  return (
    <View>
      {items.map((item, index) => {
        const isActive  = index === activeIndex;
        const shiftAnim = shiftValues.current[index] ?? 0;

        return (
          <Animated.View
            key={item.label}
            style={{
              height: DRAG_ITEM_HEIGHT,
              flexDirection: 'row',
              alignItems: 'center',
              paddingRight: 16,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: colors.border,
              backgroundColor: isActive ? colors.surfaceElevated : colors.surface,
              zIndex: isActive ? 10 : 1,
              transform: [{ translateY: isActive ? dragTranslate : shiftAnim }],
            }}
          >
            {/* Drag handle — PanResponder lives here */}
            <View
              {...panResponders.current[index]?.panHandlers}
              style={{ width: 44, height: DRAG_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="reorder-three-outline" size={20} color={colors.textTertiary} />
            </View>

            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              {renderItem(item, index)}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
