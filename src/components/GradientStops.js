import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';
import { gradientColors } from '../utils/color';

// Start / (Middle) / End stop chips + a preview bar of `previewCount` cells.
// The parent owns the stops and which one is being edited.
export default function GradientStops({
  stops, active, onSelect, onStopsChange, previewCount, previewHint,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const labels = stops.length === 3 ? ['Start', 'Middle', 'End'] : ['Start', 'End'];
  const preview = useMemo(() => gradientColors(stops, previewCount), [stops, previewCount]);

  const toggleMiddle = () => {
    if (stops.length === 3) {
      onStopsChange([stops[0], stops[2]]);
      onSelect(Math.min(active, 1));
    } else {
      onStopsChange([stops[0], gradientColors(stops, 3)[1], stops[1]]);
      onSelect(1);
    }
  };

  return (
    <>
      <View style={styles.row}>
        {stops.map((c, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.stop, i === active && styles.stopActive]}
            onPress={() => onSelect(i)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${labels[i].toLowerCase()} colour`}
            accessibilityState={{ selected: i === active }}
          >
            <View style={[styles.swatch, { backgroundColor: c }]} />
            <Text style={[styles.label, i === active && { color: colors.accent }]}>{labels[i]}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.spacer} />
        <TouchableOpacity onPress={toggleMiddle} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.link}>{stops.length === 3 ? '− Middle' : '+ Middle'}</Text>
        </TouchableOpacity>
      </View>

      {previewCount >= 2 ? (
        <View style={styles.preview}>
          {preview.map((c, i) => <View key={i} style={[styles.cell, { backgroundColor: c }]} />)}
        </View>
      ) : previewHint ? (
        <Text style={styles.hint}>{previewHint}</Text>
      ) : null}
    </>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  stop: {
    alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent',
  },
  stopActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  swatch: { width: 32, height: 32, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  label: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  spacer: { flex: 1 },
  link: { ...type.caption, color: colors.accent, fontWeight: '700' },
  preview: {
    flexDirection: 'row', height: 18, borderRadius: radius.sm, overflow: 'hidden',
    gap: 2, marginBottom: spacing.md,
  },
  cell: { flex: 1 },
  hint: { ...type.caption, color: colors.textSecondary, marginBottom: spacing.sm },
});
