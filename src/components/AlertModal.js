import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';

const ICON_MAP = {
  danger:  { name: 'warning-outline',             tintKey: 'danger',  bgKey: 'dangerSoft'  },
  error:   { name: 'alert-circle-outline',        tintKey: 'danger',  bgKey: 'dangerSoft'  },
  success: { name: 'checkmark-circle-outline',    tintKey: 'success', bgKey: 'successSoft' },
  info:    { name: 'information-circle-outline',  tintKey: 'accent',  bgKey: 'accentSoft'  },
  warning: { name: 'warning-outline',             tintKey: 'warning', bgKey: 'warningSoft' },
};

export default function AlertModal({
  mode = 'alert',
  type = 'info',
  icon,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel  = 'Cancel',
  options,
  onClose,
}) {
  const { colors, shadow } = useTheme();

  const backdropAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim    = useRef(new Animated.Value(0.88)).current;
  const slideAnim    = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 1, duration: 210, useNativeDriver: true }),
      Animated.spring(scaleAnim,   { toValue: 1, tension: 300, friction: 22, useNativeDriver: true }),
      Animated.spring(slideAnim,   { toValue: 0, tension: 300, friction: 22, useNativeDriver: true }),
    ]).start();
  }, []);

  const cfg       = ICON_MAP[type] ?? ICON_MAP.info;
  const iconName  = icon ?? cfg.name;
  const iconColor = colors[cfg.tintKey];
  const iconBg    = colors[cfg.bgKey];
  const isDanger  = type === 'danger' || type === 'error';
  const confirmColor = isDanger ? colors.danger : colors.accent;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim, backgroundColor: colors.overlay }]}>
        <Animated.View style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
          shadow.md,
          { transform: [{ scale: scaleAnim }, { translateY: slideAnim }] },
        ]}>

          <View style={styles.body}>
            <View style={[styles.iconRing, { backgroundColor: iconBg }]}>
              <Ionicons name={iconName} size={28} color={iconColor} />
            </View>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {message ? (
              <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {mode === 'alert' && (
            <TouchableOpacity style={styles.singleAction} onPress={() => onClose(undefined)}>
              <Text style={[styles.actionLabel, { color: confirmColor, fontWeight: '700' }]}>
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          )}

          {mode === 'confirm' && (
            <View style={styles.dualActions}>
              <TouchableOpacity
                style={[styles.action, { borderRightWidth: 1, borderRightColor: colors.border }]}
                onPress={() => onClose(false)}
              >
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{cancelLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.action} onPress={() => onClose(true)}>
                <Text style={[styles.actionLabel, { color: confirmColor, fontWeight: '700' }]}>
                  {confirmLabel}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {mode === 'options' && options?.map((opt, i) => {
            const isCancel      = opt.style === 'cancel';
            const isDestructive = opt.style === 'destructive';
            const labelColor    = isDestructive ? colors.danger : isCancel ? colors.textSecondary : colors.accent;
            return (
              <TouchableOpacity
                key={String(i)}
                style={[styles.option, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                onPress={() => onClose(isCancel ? null : opt.value)}
              >
                <Text style={[styles.actionLabel, { color: labelColor, fontWeight: isCancel ? '400' : '700' }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  card: {
    width: '100%', maxWidth: 320,
    borderRadius: radius.xxl, borderWidth: 1,
    overflow: 'hidden',
  },
  body: {
    alignItems: 'center',
    paddingTop: spacing.xxl + 4,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  iconRing: {
    width: 60, height: 60, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title:   { ...type.h3, textAlign: 'center' },
  message: { ...type.body, textAlign: 'center', lineHeight: 22 },
  divider: { height: 1 },

  singleAction: {
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  dualActions: { flexDirection: 'row' },
  action: {
    flex: 1, height: 52, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...type.bodyMed },

  option: {
    height: 52, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
});
