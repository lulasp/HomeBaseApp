import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, isValid } from 'date-fns';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';

// On web, render a native <input type="date"> via a thin inline component.
// This avoids any dependency on the native module on web.
function WebDateInput({ value, onChange, hasError, colors }) {
  const fieldStyle = {
    height: 50,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    border: `1px solid ${hasError ? colors.danger : colors.border}`,
    borderRadius: radius.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    boxSizing: 'border-box',
  };
  const inputStyle = {
    flex: 1,
    border: 'none',
    background: 'transparent',
    fontSize: 15,
    color: value ? colors.textPrimary : colors.textTertiary,
    outline: 'none',
    cursor: 'pointer',
  };
  return (
    <div style={fieldStyle}>
      <span style={{ color: colors.textTertiary, display: 'flex', alignItems: 'center' }}>
        📅
      </span>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: colors.textTertiary, display: 'flex', alignItems: 'center' }}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export default function DatePickerInput({
  value, onChange, hasError, placeholder = 'Optional', accessibilityLabel = 'Select expiry date',
}) {
  const { colors, theme } = useTheme();
  const [showPicker, setShowPicker] = useState(false);

  const parsedDate = value ? parseISO(value) : null;
  const dateIsValid = parsedDate && isValid(parsedDate);
  const displayText = dateIsValid ? format(parsedDate, 'MMM d, yyyy') : '';
  const pickerDate = dateIsValid ? parsedDate : new Date();

  const handleClear = () => {
    onChange('');
    setShowPicker(false);
  };

  const styles = makeStyles(colors);

  if (Platform.OS === 'web') {
    return <WebDateInput value={value} onChange={onChange} hasError={hasError} colors={colors} />;
  }

  // Android: tapping opens native date dialog; DateTimePicker is only mounted
  // when showPicker is true so it fires the dialog automatically.
  if (Platform.OS === 'android') {
    return (
      <View>
        <TouchableOpacity
          style={[styles.field, hasError && styles.fieldError]}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Ionicons name="calendar-outline" size={17} color={colors.textTertiary} />
          <Text style={[styles.fieldText, !displayText && styles.placeholder]}>
            {displayText || placeholder}
          </Text>
          {displayText ? (
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-down" size={15} color={colors.textTertiary} />
          )}
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={pickerDate}
            mode="date"
            display="default"
            onChange={(e, d) => {
              setShowPicker(false);
              if (e.type !== 'dismissed' && d) onChange(format(d, 'yyyy-MM-dd'));
            }}
          />
        )}
      </View>
    );
  }

  // iOS: render an inline spinner that expands below the field button.
  // Inline avoids all nested-modal / popover-from-modal issues that
  // display="compact" and display="inline" have when inside a Modal sheet.
  return (
    <View>
      <TouchableOpacity
        style={[styles.field, hasError && styles.fieldError]}
        onPress={() => setShowPicker((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Ionicons name="calendar-outline" size={17} color={colors.textTertiary} />
        <Text style={[styles.fieldText, !displayText && styles.placeholder]}>
          {displayText || placeholder}
        </Text>
        {displayText ? (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <Ionicons
            name={showPicker ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={colors.textTertiary}
          />
        )}
      </TouchableOpacity>

      {showPicker && (
        <View style={styles.iosSpinnerWrapper}>
          <View style={styles.iosSpinnerHeader}>
            <TouchableOpacity onPress={handleClear}>
              <Text style={[styles.iosAction, { color: colors.danger }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={[styles.iosAction, { color: colors.accent }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={pickerDate}
            mode="date"
            display="spinner"
            onChange={(_, d) => { if (d) onChange(format(d, 'yyyy-MM-dd')); }}
            themeVariant={theme}
            style={styles.iosSpinner}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  field: {
    height: 50, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated,
  },
  fieldError:  { borderColor: colors.danger, borderWidth: 1.5 },
  fieldText:   { ...type.body, color: colors.textPrimary, flex: 1 },
  placeholder: { color: colors.textTertiary },

  iosSpinnerWrapper: {
    marginTop: 4,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
  },
  iosSpinnerHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iosAction:   { ...type.bodyMed, fontWeight: '600' },
  iosSpinner:  { width: '100%', height: 200 },
});
