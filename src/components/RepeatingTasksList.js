import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Switch, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { useNotification } from '../context/NotificationContext';
import { spacing, radius, type } from '../theme/colors';
import {
  subscribeTodoRecurrences, updateTodoRecurrence, deleteTodoRecurrence,
} from '../services/firestore';
import { formatRecurrenceDays } from '../utils/weeklyTodos';

// Household settings → Repeating tasks. Changes save immediately (not via the
// screen's Save button) since rules are live, household-wide state.
export default function RepeatingTasksList({ householdId }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showConfirm } = useAlert();
  const { notify } = useNotification();
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!householdId) return undefined;
    return subscribeTodoRecurrences(
      householdId,
      (r) => { setRules(r); setError(null); },
      (err) => setError(err?.message || 'Could not load repeating tasks.'),
    );
  }, [householdId]);

  const sorted = useMemo(
    () => (rules ?? []).slice().sort((a, b) => a.text.localeCompare(b.text)),
    [rules],
  );

  const fail = (title) => (err) => {
    console.error(err);
    notify(title, err?.message || 'Please try again.', { type: 'error' });
  };

  // Resuming starts from today so it doesn't back-fill days already gone this week
  const setActive = (rule, active) => {
    const patch = active
      ? { active, startsOn: format(new Date(), 'yyyy-MM-dd'), lastMaterializedWeek: null }
      : { active };
    updateTodoRecurrence(householdId, rule.id, patch).catch(fail('Could not update'));
  };

  const remove = async (rule) => {
    const confirmed = await showConfirm({
      title: 'Delete repeating task',
      message: `"${rule.text}" won't be added to future weeks. Tasks already created stay.`,
      type: 'danger',
      confirmLabel: 'Delete',
    });
    if (confirmed) deleteTodoRecurrence(householdId, rule.id).catch(fail('Could not delete'));
  };

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
      </View>
    );
  }

  if (rules === null) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {sorted.length === 0 ? (
        <Text style={styles.hint}>
          No repeating tasks yet. On Home, long-press a task (or tap it, then the repeat icon) to repeat it weekly.
        </Text>
      ) : (
        <>
          {sorted.map((rule, i) => (
            <View key={rule.id} style={[styles.row, i > 0 && styles.rowDivider]}>
              <Ionicons name="repeat-outline" size={18} color={rule.active ? colors.accent : colors.textTertiary} />
              <View style={styles.rowText}>
                <Text style={[styles.title, !rule.active && { color: colors.textTertiary }]} numberOfLines={2}>
                  {rule.text}
                </Text>
                <Text style={styles.hint}>
                  {formatRecurrenceDays(rule.days)}{rule.active ? '' : ' · paused'}
                </Text>
              </View>
              <Switch
                value={!!rule.active}
                onValueChange={(v) => setActive(rule, v)}
                trackColor={{ false: colors.muted, true: colors.accent }}
                thumbColor="#fff"
                ios_backgroundColor={colors.muted}
                accessibilityLabel={`${rule.text} active`}
              />
              <TouchableOpacity
                onPress={() => remove(rule)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${rule.text}`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
          <Text style={styles.hint}>
            Paused tasks aren't added to new weeks. Change the days by long-pressing the task on Home.
          </Text>
        </>
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    padding: spacing.lg, gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  rowText: { flex: 1 },
  title: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
  hint: { ...type.caption, color: colors.textTertiary },
});
