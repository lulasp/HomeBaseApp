import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';

const TYPE_CONFIG = {
  success: { icon: 'checkmark-circle', colorKey: 'success', softKey: 'successSoft' },
  error:   { icon: 'close-circle',     colorKey: 'danger',  softKey: 'dangerSoft'  },
  warning: { icon: 'warning',          colorKey: 'amber',   softKey: 'amberSoft'   },
  info:    { icon: 'information-circle', colorKey: 'accent', softKey: 'accentSoft' },
};

const DURATION = 3500;

export default function ToastNotification({ visible, title, body, type = 'info', onHide }) {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const timer      = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.parallel([
      Animated.timing(translateY, { toValue: 40, duration: 220, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity,    { toValue: 0,  duration: 220, useNativeDriver: Platform.OS !== 'web' }),
    ]).start(() => onHide?.());
  }, [translateY, opacity, onHide]);

  useEffect(() => {
    if (!visible) return;

    translateY.setValue(40);
    opacity.setValue(0);

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity,    { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();

    timer.current = setTimeout(hide, DURATION);
    return () => clearTimeout(timer.current);
  }, [visible, title, body]);

  if (!visible) return null;

  const cfg       = TYPE_CONFIG[type] ?? TYPE_CONFIG.info;
  const iconColor = colors[cfg.colorKey];
  const bgColor   = colors[cfg.softKey];

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.iconWrap, { backgroundColor: bgColor }]}>
        <Ionicons name={cfg.icon} size={18} color={iconColor} />
      </View>

      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {!!body && (
          <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>
            {body}
          </Text>
        )}
      </View>

      <TouchableOpacity
        onPress={hide}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Dismiss notification"
        accessibilityRole="button"
      >
        <Ionicons name="close" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    right: spacing.xl,
    maxWidth: 320,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.20,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
    zIndex: 9999,
  },
  iconWrap: {
    width: 34, height: 34,
    borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1, gap: 2 },
  title:    { ...type.bodyMed },
  body:     { ...type.bodySm },
});
