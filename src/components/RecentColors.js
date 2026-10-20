import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, type } from '../theme/colors';

const SIZE = 28;
const BADGE = 18;

// "RECENT" swatch row. Long-press any swatch to show a remove (×) badge on
// each; "Done" hides them again. Renders nothing when the list is empty.
export default function RecentColors({ colors: recents, selected, onSelect, onRemove }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (recents.length === 0) setRemoving(false);
  }, [recents.length]);

  if (recents.length === 0) return null;

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.label}>RECENT</Text>
        {removing ? (
          <TouchableOpacity onPress={() => setRemoving(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>Long-press to remove</Text>
        )}
      </View>
      <View style={styles.row}>
        {recents.map((c) => (
          // Badge is a sibling, not a child, of the swatch: nested
          // TouchableOpacity renders as nested <button>s on web.
          <View key={c} style={styles.cell}>
            <TouchableOpacity
              style={[styles.swatch, { backgroundColor: c }, !removing && selected === c && styles.swatchSelected]}
              onPress={() => (removing ? onRemove(c) : onSelect(c))}
              onLongPress={() => setRemoving(true)}
              accessibilityRole="button"
              accessibilityLabel={removing ? `Remove recent color ${c}` : `Select recent color ${c}`}
            />
            {removing && (
              <TouchableOpacity
                style={styles.badge}
                onPress={() => onRemove(c)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove recent color ${c}`}
              >
                <Ionicons name="close" size={12} color={colors.accentForeground} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, marginBottom: 6,
  },
  label: { ...type.caption, color: colors.textTertiary, fontWeight: '700' },
  hint: { ...type.caption, color: colors.textTertiary },
  done: { ...type.caption, color: colors.accent, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Room for the badge overhanging the top-right corner
  cell: { paddingTop: BADGE / 3, paddingRight: BADGE / 3 },
  swatch: {
    width: SIZE, height: SIZE, borderRadius: radius.full,
    borderWidth: 2, borderColor: 'transparent',
  },
  swatchSelected: { borderColor: colors.accent },
  badge: {
    position: 'absolute', top: 0, right: 0,
    width: BADGE, height: BADGE, borderRadius: BADGE / 2,
    backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
});
