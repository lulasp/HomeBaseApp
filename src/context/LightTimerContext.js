import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './ThemeContext';
import { spacing, radius, type } from '../theme/colors';
import { useIsDesktop } from '../navigation/TabBar';
import { navigateTo } from '../navigation/navigationRef';

const LightTimerContext = createContext(null);

export const TIMER_DURATIONS = {
  '15 min': 15 * 60,
  '30 min': 30 * 60,
  '1 hr':   60 * 60,
  '2 hr':   120 * 60,
};

const MAX_INDIVIDUAL = 2;

// Bubble dimensions
const BUBBLE_SIZE = 52;
const BUBBLE_GAP  = 8;

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Individual timer widget ───────────────────────────────────────────────────

function TimerWidget({ deviceId, deviceName, remaining, total, onCancel, stackIndex, fromBubble }) {
  const { colors } = useTheme();
  const isDesktop  = useIsDesktop();
  const baseBottom = fromBubble
    ? (isDesktop ? spacing.xl : 148) + BUBBLE_SIZE + BUBBLE_GAP
    : undefined;
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity,    { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, []);

  const progress       = total > 0 ? remaining / total : 0;
  const handleNavigate = () => navigateTo('HomeLights', { selectedDeviceId: deviceId });

  if (isDesktop) {
    const bottom = (baseBottom ?? spacing.xl) + stackIndex * 80;
    return (
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border, bottom, transform: [{ translateY }], opacity },
        ]}
      >
        <View style={[styles.cardTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.cardFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
        </View>
        <TouchableOpacity
          style={styles.cardBody}
          onPress={handleNavigate}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Go to ${deviceName}`}
        >
          <View style={[styles.cardIcon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="timer" size={16} color={colors.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={[styles.cardTime, { color: colors.textPrimary }]}>
              {formatTime(remaining)}
            </Text>
            <Text style={[styles.cardDevice, { color: colors.textTertiary }]} numberOfLines={1}>
              {deviceName}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel timer"
          >
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // Mobile pill — stack above whatever base bottom is given
  const bottom = (baseBottom ?? 148) + stackIndex * 44;
  return (
    <Animated.View
      style={[
        styles.pill,
        { backgroundColor: colors.surface, borderColor: colors.border, bottom, transform: [{ translateY }], opacity },
      ]}
    >
      <View style={[styles.pillTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.pillFill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
      </View>
      <TouchableOpacity
        style={styles.pillRow}
        onPress={handleNavigate}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${deviceName}`}
      >
        <Ionicons name="timer-outline" size={13} color={colors.accent} />
        <Text style={[styles.pillTime, { color: colors.textPrimary }]}>
          {formatTime(remaining)}
        </Text>
        <View style={[styles.pillSep, { backgroundColor: colors.border }]} />
        <Text style={[styles.pillDevice, { color: colors.textTertiary }]} numberOfLines={1}>
          {deviceName}
        </Text>
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Cancel timer"
        >
          <Ionicons name="close" size={13} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Collapsed bubble ──────────────────────────────────────────────────────────

function TimerBubble({ count, isExpanded, onToggle }) {
  const { colors } = useTheme();
  const isDesktop  = useIsDesktop();
  const scale   = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, tension: 120, friction: 7, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, []);

  const bottom = isDesktop ? spacing.xl : 148;

  return (
    <Animated.View style={[styles.bubbleOuter, { bottom, transform: [{ scale }], opacity }]}>
      <TouchableOpacity
        style={[styles.bubbleBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={onToggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? 'Collapse timers' : `${count} active timers — tap to expand`}
      >
        <Ionicons
          name={isExpanded ? 'chevron-down' : 'timer'}
          size={22}
          color={colors.accent}
        />
      </TouchableOpacity>

      {/* Count badge — hide while expanded since the list is visible */}
      {!isExpanded && (
        <View style={[styles.bubbleBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.bubbleBadgeText, { color: '#fff' }]}>{count}</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function LightTimerProvider({ children }) {
  const [timers, setTimers]       = useState({});
  const [isExpanded, setExpanded] = useState(false);
  const intervalRef = useRef(null);

  const ensureInterval = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      setTimers((prev) => {
        const next = {};
        let hasAny = false;
        for (const [id, t] of Object.entries(prev)) {
          if (t.remaining <= 1) continue;
          next[id] = { ...t, remaining: t.remaining - 1 };
          hasAny = true;
        }
        if (!hasAny) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return next;
      });
    }, 1000);
  }, []);

  const startTimer = useCallback((deviceId, deviceName, label) => {
    const seconds = TIMER_DURATIONS[label];
    if (!seconds) return;
    setTimers((prev) => ({
      ...prev,
      [deviceId]: { deviceName, label, remaining: seconds, total: seconds },
    }));
    ensureInterval();
  }, [ensureInterval]);

  const cancelTimer = useCallback((deviceId) => {
    setTimers((prev) => {
      const next = { ...prev };
      delete next[deviceId];
      if (Object.keys(next).length === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  // Auto-collapse expansion when count drops back to individual range
  useEffect(() => {
    if (Object.keys(timers).length <= MAX_INDIVIDUAL) {
      setExpanded(false);
    }
  }, [timers]);

  const timerEntries = Object.entries(timers);
  const collapsed    = timerEntries.length > MAX_INDIVIDUAL;

  return (
    <LightTimerContext.Provider value={{ startTimer, cancelTimer, activeTimers: timers }}>
      {children}

      {collapsed ? (
        <>
          {/* Expanded pill list above the bubble */}
          {isExpanded && timerEntries.map(([deviceId, t], index) => (
            <TimerWidget
              key={`expanded-${deviceId}`}
              deviceId={deviceId}
              deviceName={t.deviceName}
              remaining={t.remaining}
              total={t.total}
              onCancel={() => cancelTimer(deviceId)}
              stackIndex={index}
              fromBubble
            />
          ))}

          {/* Bubble toggle */}
          <TimerBubble
            count={timerEntries.length}
            isExpanded={isExpanded}
            onToggle={() => setExpanded((v) => !v)}
          />
        </>
      ) : (
        timerEntries.map(([deviceId, t], index) => (
          <TimerWidget
            key={deviceId}
            deviceId={deviceId}
            deviceName={t.deviceName}
            remaining={t.remaining}
            total={t.total}
            onCancel={() => cancelTimer(deviceId)}
            stackIndex={index}
          />
        ))
      )}
    </LightTimerContext.Provider>
  );
}

export const useLightTimer = () => useContext(LightTimerContext);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Desktop card
  card: {
    position: 'absolute',
    right: spacing.xl,
    width: 184,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
    zIndex: 9998,
  },
  cardTrack: { height: 3 },
  cardFill:  { height: '100%' },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardIcon: {
    width: 32, height: 32,
    borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  cardText:   { flex: 1 },
  cardTime:   { ...type.bodyMed, fontSize: 16, letterSpacing: 0.5 },
  cardDevice: { ...type.caption, marginTop: 1 },

  // Mobile pill
  pill: {
    position: 'absolute',
    right: spacing.xl,
    width: 178,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
    zIndex: 9998,
  },
  pillTrack: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 2,
  },
  pillFill: { height: 2 },
  pillRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  pillTime: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  pillSep: {
    width: 1,
    height: 10,
    borderRadius: 1,
  },
  pillDevice: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
  },

  // Collapsed bubble
  bubbleOuter: {
    position: 'absolute',
    right: spacing.xl,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubbleBtn: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  bubbleBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
