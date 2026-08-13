import React from 'react';
import { Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';

// Horizontal emoji-icon picker used by the household edit modals (category,
// finance category, emergency contact). Reuses the same look those modals had.
export default function IconPicker({ icons, value, onChange, label = 'Icon' }) {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.picker}
        contentContainerStyle={styles.pickerContent}
      >
        {icons.map((ic) => {
          const selected = value === ic;
          return (
            <TouchableOpacity
              key={ic}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => onChange(ic)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Select icon ${ic}`}
            >
              <Text style={styles.optionText}>{ic}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  label: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  picker: { marginVertical: 4 },
  pickerContent: { gap: 8, paddingVertical: 4 },
  option: {
    width: 44, height: 44, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionText: { fontSize: 22 },
});
