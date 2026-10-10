import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';
import { parseTimeString, formatTimeString, formatReminderLabel } from '../utils/reminders';

// Compact time control for inline use (see the weekly-todo editor).
// `value` is an 'HH:mm' string or null; `onChange` receives the same or null
// when cleared. Mirrors DatePickerInput's platform split: a native <input> on
// web, a dialog on Android, an inline spinner on iOS.
export default function TimePickerChip({ value, onChange, placeholder = 'Remind', accessibilityLabel = 'Set a reminder time' }) {
  const { colors, theme } = useTheme();
  const [showPicker, setShowPicker] = useState(false);

  const parsed = parseTimeString(value);
  const label = parsed ? formatReminderLabel(value) : placeholder;

  const pickerDate = new Date();
  pickerDate.setHours(parsed ? parsed.hours : 9, parsed ? parsed.minutes : 0, 0, 0);

  const clear = () => { onChange(null); setShowPicker(false); };
  const styles = makeStyles(colors, !!parsed);

  // A plain render function, not a nested component — a component declared in
  // the render body would remount (and drop press state) on every render.
  const renderChip = (onPress) => (
    <View style={styles.chip}>
      <TouchableOpacity
        style={styles.chipMain}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={parsed ? `Reminder at ${label}. Change` : accessibilityLabel}
      >
        <Ionicons
          name={parsed ? 'notifications' : 'notifications-outline'}
          size={14}
          color={parsed ? colors.accent : colors.textTertiary}
        />
        <Text style={styles.chipText}>{label}</Text>
      </TouchableOpacity>
      {parsed && (
        <TouchableOpacity
          onPress={clear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear reminder"
        >
          <Ionicons name="close-circle" size={14} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={styles.chip}>
        <Ionicons
          name={parsed ? 'notifications' : 'notifications-outline'}
          size={14}
          color={parsed ? colors.accent : colors.textTertiary}
        />
        <input
          type="time"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={accessibilityLabel}
          style={{
            border: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            color: parsed ? colors.accent : colors.textTertiary,
            outline: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        />
        {parsed && (
          <TouchableOpacity
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear reminder"
          >
            <Ionicons name="close-circle" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View>
        {renderChip(() => setShowPicker(true))}
        {showPicker && (
          <DateTimePicker
            value={pickerDate}
            mode="time"
            display="default"
            onChange={(e, d) => {
              setShowPicker(false);
              if (e.type !== 'dismissed' && d) onChange(formatTimeString(d));
            }}
          />
        )}
      </View>
    );
  }

  return (
    <View>
      {renderChip(() => setShowPicker((v) => !v))}
      {showPicker && (
        <View style={styles.iosSpinnerWrapper}>
          <View style={styles.iosSpinnerHeader}>
            <TouchableOpacity onPress={clear}>
              <Text style={[styles.iosAction, { color: colors.danger }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={[styles.iosAction, { color: colors.accent }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={pickerDate}
            mode="time"
            display="spinner"
            onChange={(_, d) => { if (d) onChange(formatTimeString(d)); }}
            themeVariant={theme}
            style={styles.iosSpinner}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors, isSet) => StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 5, paddingHorizontal: 9,
    borderRadius: radius.full,
    backgroundColor: isSet ? colors.accentSoft : colors.muted,
    alignSelf: 'flex-start',
  },
  chipMain: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: {
    ...type.caption, fontSize: 12, fontWeight: '700',
    color: isSet ? colors.accent : colors.textTertiary,
  },
  iosSpinnerWrapper: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated, marginTop: spacing.sm,
    overflow: 'hidden',
  },
  iosSpinnerHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iosAction: { ...type.bodyMed, fontSize: 14, fontWeight: '600' },
  iosSpinner: { height: 150 },
});
