import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Image, PanResponder, StyleSheet, Platform,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';
import { normalizeHex, wheelPointToHex, hexToWheelPoint } from '../utils/color';

const WHEEL = require('../../assets/color-wheel.png');
const THUMB = 28;

// Hue/saturation wheel + hex input. Brightness is deliberately not part of
// the picker — lights take it as a separate command.
//   onChange(hex)          — fires continuously while dragging
//   onChangeComplete(hex)  — fires on release and on a valid hex submit
//   onDragActive(bool)     — lets the parent disable its ScrollView mid-drag
export default function ColorPicker({
  color, onChange, onChangeComplete, onDragActive, size = 220, disabled,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, size), [colors, size]);
  const r = size / 2;

  // Latest props read through a ref so the PanResponder (created once) never goes stale
  const live = useRef({});
  live.current = { onChange, onChangeComplete, onDragActive, disabled, r };

  const start = useRef({ x: 0, y: 0 });
  const last = useRef(null);

  const pan = useMemo(() => {
    const emit = (x, y) => {
      const hex = wheelPointToHex(x, y, live.current.r);
      if (hex !== last.current) {
        last.current = hex;
        live.current.onChange?.(hex);
      }
    };
    const finish = () => {
      live.current.onDragActive?.(false);
      if (last.current) live.current.onChangeComplete?.(last.current);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      // Keep the drag when the parent ScrollView tries to take over
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // Children have pointerEvents="none", so location is relative to the wheel
        start.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        last.current = null;
        live.current.onDragActive?.(true);
        emit(start.current.x, start.current.y);
      },
      onPanResponderMove: (_, g) => emit(start.current.x + g.dx, start.current.y + g.dy),
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  const thumb = hexToWheelPoint(color, r);

  // Hex field keeps its own draft while focused; otherwise mirrors `color`
  const [draft, setDraft] = useState(color ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(color ?? '');
  }, [color, focused]);

  const draftValid = normalizeHex(draft) != null;
  const submitDraft = () => {
    const hex = normalizeHex(draft);
    if (!hex) { setDraft(color ?? ''); return; }
    setDraft(hex);
    if (hex !== color) onChangeComplete?.(hex);
  };

  return (
    <View style={styles.root}>
      <View
        style={[styles.wheel, disabled && styles.disabled]}
        {...pan.panHandlers}
        accessibilityLabel="Colour wheel"
      >
        <Image source={WHEEL} style={styles.wheelImage} pointerEvents="none" />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { left: thumb.x - THUMB / 2, top: thumb.y - THUMB / 2, backgroundColor: color },
          ]}
        />
      </View>

      <View style={styles.hexRow}>
        <Text style={styles.hexLabel}>HEX</Text>
        <TextInput
          style={[styles.hexInput, focused && !draftValid && draft !== '' && styles.hexInputInvalid]}
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); submitDraft(); }}
          onSubmitEditing={submitDraft}
          editable={!disabled}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholder="#FF8800"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          accessibilityLabel="Hex colour"
        />
      </View>
    </View>
  );
}

const makeStyles = (colors, size) => StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.md },
  wheel: {
    width: size, height: size,
    ...(Platform.OS === 'web' ? { touchAction: 'none', cursor: 'crosshair', userSelect: 'none' } : null),
  },
  wheelImage: { width: size, height: size },
  disabled: { opacity: 0.5 },
  thumb: {
    position: 'absolute',
    width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    borderWidth: 3, borderColor: colors.accentForeground,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: colors.overlayLight }],
  },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hexLabel: { ...type.label, color: colors.textTertiary },
  hexInput: {
    ...type.bodyMed, color: colors.textPrimary,
    width: 120,
    backgroundColor: colors.muted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  hexInputInvalid: { borderColor: colors.danger },
});
