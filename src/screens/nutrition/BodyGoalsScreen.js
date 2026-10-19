import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';

import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import useBodyGoals from '../../hooks/useBodyGoals';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { saveBodyProfile, logWeight, deleteWeightLog } from '../../services/firestore';
import {
  ACTIVITY_LEVELS, GOALS, WEEKLY_RATES,
  calcBMI, bmiCategory, calcGoalProgress, goalDelta, parseMetric, calcAge,
} from '../../utils/bodyMetrics';
import DatePickerInput from '../../components/DatePickerInput';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';

const CHART_POINTS = 30;
const CHART_HEIGHT = 110;
const RECENT_LOGS  = 10;

const fmtKg = (n) => (n == null ? '—' : `${Math.round(n * 10) / 10} kg`);
const fmtDate = (d) => format(parseISO(d), 'MMM d, yyyy');

const emptyForm = {
  sex: null, birthDate: '', heightCm: '', activityLevel: 'moderate',
  goal: 'maintain', weeklyRateKg: 0.5, goalWeightKg: '',
};

const profileToForm = (p) => ({
  sex:           p.sex ?? null,
  birthDate:     p.birthDate ?? '',
  heightCm:      p.heightCm ? String(p.heightCm) : '',
  activityLevel: p.activityLevel ?? 'moderate',
  goal:          p.goal ?? 'maintain',
  weeklyRateKg:  p.weeklyRateKg ?? 0.5,
  goalWeightKg:  p.goalWeightKg ? String(p.goalWeightKg) : '',
});

export default function BodyGoalsScreen({ navigation }) {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const navScrollProps = useNavScrollProps();
  const { showConfirm, showAlert } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const contentKey = useEntranceReplay();
  const windowHeight = useVisualViewportHeight();

  const { profile, logs, currentWeight, calories, loading, error } = useBodyGoals(householdId, user?.uid);

  const [weightText, setWeightText] = useState('');
  const [logDate, setLogDate]       = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [logging, setLogging]       = useState(false);

  const [form, setForm]         = useState(emptyForm);
  const [formLoaded, setFormLoaded] = useState(false);
  const [saving, setSaving]     = useState(false);

  // Seed the form once from the stored profile; later snapshots don't clobber edits.
  useEffect(() => {
    if (loading || formLoaded) return;
    if (profile) setForm(profileToForm(profile));
    setFormLoaded(true);
  }, [loading, profile, formLoaded]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const bmi      = calcBMI(currentWeight, profile?.heightCm);
  const bmiCat   = bmiCategory(bmi);
  const progress = calcGoalProgress({
    logs, goalWeightKg: profile?.goalWeightKg, weeklyRateKg: profile?.goal === 'maintain' ? null : profile?.weeklyRateKg,
  });

  const handleLog = async () => {
    const kg = parseMetric(weightText);
    if (!kg || kg < 20 || kg > 400) {
      showAlert({ title: 'Invalid weight', message: 'Enter a weight in kg between 20 and 400.', type: 'warning' });
      return;
    }
    if (!logDate) {
      showAlert({ title: 'Pick a date', message: 'Choose the date of this weigh-in.', type: 'warning' });
      return;
    }
    setLogging(true);
    try {
      await logWeight(householdId, user.uid, logDate, kg);
      setWeightText('');
      notify('Weight logged', `${fmtKg(kg)} on ${fmtDate(logDate)}.`, { type: 'success' });
    } catch (e) {
      showAlert({ title: 'Could not save', message: e.message, type: 'danger' });
    } finally {
      setLogging(false);
    }
  };

  const handleDelete = async (log) => {
    const ok = await showConfirm({
      title: 'Delete entry?',
      message: `${fmtKg(log.weightKg)} on ${fmtDate(log.date)}`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteWeightLog(householdId, log.id);
    } catch (e) {
      showAlert({ title: 'Could not delete', message: e.message, type: 'danger' });
    }
  };

  const handleSaveProfile = async () => {
    const heightCm     = parseMetric(form.heightCm);
    const goalWeightKg = form.goalWeightKg.trim() ? parseMetric(form.goalWeightKg) : null;
    const age          = calcAge(form.birthDate);
    const problems = [];
    if (!form.sex) problems.push('Choose a sex (used by the BMR formula).');
    if (age == null || age < 13) problems.push('Enter a valid birth date (13+ years).');
    if (!heightCm || heightCm < 80 || heightCm > 250) problems.push('Height must be 80–250 cm.');
    if (form.goalWeightKg.trim() && (!goalWeightKg || goalWeightKg < 20 || goalWeightKg > 400)) {
      problems.push('Goal weight must be 20–400 kg.');
    }
    if (problems.length) {
      showAlert({ title: 'Check your details', message: problems.join('\n'), type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await saveBodyProfile(householdId, user.uid, {
        sex: form.sex,
        birthDate: form.birthDate,
        heightCm,
        activityLevel: form.activityLevel,
        goal: form.goal,
        weeklyRateKg: form.weeklyRateKg,
        goalWeightKg,
      });
      notify('Profile saved', 'Your calorie target has been updated.', { type: 'success' });
    } catch (e) {
      showAlert({ title: 'Could not save', message: e.message, type: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const contentWidth = isDesktop
    ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }
    : null;

  const chartLogs = logs.slice(-CHART_POINTS);
  const recent    = logs.slice(-RECENT_LOGS).reverse();

  return (
    <SafeAreaView
      style={[
        styles.root,
        Platform.OS === 'android' && { paddingTop: 24 },
        Platform.OS === 'web' && { height: windowHeight },
      ]}
    >
      <ScrollView
        key={contentKey}
        style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
        contentContainerStyle={[styles.container, contentWidth]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...navScrollProps}
      >
        <Rise index={0}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title}>Body & goals</Text>
            <View style={{ width: 26 }} />
          </View>
        </Rise>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
            <Text style={styles.emptyTitle}>Couldn't load your data</Text>
            <Text style={styles.emptySub}>{error.message}</Text>
          </View>
        ) : (
          <>
            {/* Stats */}
            <Rise index={1} style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{fmtKg(currentWeight)}</Text>
                <Text style={styles.statLabel}>Current</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, bmiCat && { color: colors[bmiCat.tone] }]}>{bmi ?? '—'}</Text>
                <Text style={styles.statLabel}>{bmiCat ? `BMI · ${bmiCat.label}` : 'BMI'}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: colors.accent }]}>
                  {calories ? calories.target.toLocaleString() : '—'}
                </Text>
                <Text style={styles.statLabel}>Target kcal/day</Text>
              </View>
            </Rise>

            {/* Calorie breakdown */}
            <Rise index={2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Suggested intake</Text>
                {calories ? (
                  <>
                    <BreakdownRow label="BMR (at rest)" value={`${calories.bmr.toLocaleString()} kcal`} styles={styles} />
                    <BreakdownRow label="Maintenance (TDEE)" value={`${calories.tdee.toLocaleString()} kcal`} styles={styles} />
                    {profile.goal !== 'maintain' && (
                      <BreakdownRow
                        label={`${profile.goal === 'lose' ? 'Lose' : 'Gain'} ${profile.weeklyRateKg} kg/week`}
                        value={`${goalDelta(profile.goal, profile.weeklyRateKg) > 0 ? '+' : '−'}${Math.round(Math.abs(goalDelta(profile.goal, profile.weeklyRateKg)))} kcal`}
                        styles={styles}
                      />
                    )}
                    <View style={styles.divider} />
                    <BreakdownRow label="Daily target" value={`${calories.target.toLocaleString()} kcal`} styles={styles} strong />
                    {calories.clamped && (
                      <View style={styles.noteRow}>
                        <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
                        <Text style={[styles.noteText, { color: colors.warning }]}>
                          Raised to the safe minimum — consider a slower weekly rate.
                        </Text>
                      </View>
                    )}
                    <Text style={styles.disclaimer}>
                      Estimate from the Mifflin-St Jeor formula. Not medical advice.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.emptySub}>
                    {!profile ? 'Fill in your profile below' : 'Log your weight'} to get a daily calorie suggestion.
                  </Text>
                )}
              </View>
            </Rise>

            {/* Log weight */}
            <Rise index={3}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Log weight</Text>
                <View style={styles.logRow}>
                  <View style={styles.weightField}>
                    <TextInput
                      style={styles.weightInput}
                      value={weightText}
                      onChangeText={setWeightText}
                      placeholder={currentWeight ? String(currentWeight) : '70.0'}
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Weight in kilograms"
                      onSubmitEditing={handleLog}
                    />
                    <Text style={styles.unit}>kg</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <DatePickerInput
                      value={logDate}
                      onChange={setLogDate}
                      placeholder="Date"
                      accessibilityLabel="Weigh-in date"
                    />
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, (logging || !weightText.trim()) && { opacity: 0.5 }]}
                  onPress={handleLog}
                  disabled={logging || !weightText.trim()}
                  accessibilityRole="button"
                >
                  {logging
                    ? <ActivityIndicator color={colors.accentForeground} />
                    : <Text style={styles.primaryBtnText}>Log weight</Text>}
                </TouchableOpacity>
              </View>
            </Rise>

            {/* Trend + goal */}
            <Rise index={4}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Trend</Text>
                {chartLogs.length < 2 ? (
                  <Text style={styles.emptySub}>Log at least two weigh-ins to see your trend.</Text>
                ) : (
                  <WeightChart logs={chartLogs} goalWeightKg={profile?.goalWeightKg} colors={colors} styles={styles} />
                )}

                {progress && (
                  <View style={styles.goalBlock}>
                    <View style={styles.goalHeader}>
                      <Text style={styles.goalLabel}>Goal {fmtKg(progress.goal)}</Text>
                      <Text style={styles.goalMeta}>
                        {progress.reached
                          ? 'Reached'
                          : `${Math.abs(progress.remaining)} kg to go`}
                      </Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[
                        styles.progressFill,
                        { width: `${Math.round(progress.fraction * 100)}%` },
                        progress.reached && { backgroundColor: colors.success },
                      ]} />
                    </View>
                    <Text style={styles.goalMeta}>
                      Started at {fmtKg(progress.start)}
                      {progress.eta && !progress.reached ? ` · est. ${format(progress.eta, 'MMM d, yyyy')}` : ''}
                    </Text>
                  </View>
                )}
              </View>
            </Rise>

            {/* Recent entries */}
            <Rise index={5}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Recent entries</Text>
                {recent.length === 0 ? (
                  <Text style={styles.emptySub}>No weigh-ins yet.</Text>
                ) : recent.map((log, i) => {
                  const prev  = recent[i + 1];
                  const delta = prev ? Math.round((log.weightKg - prev.weightKg) * 10) / 10 : null;
                  return (
                    <View key={log.id} style={[styles.logItem, i > 0 && styles.logItemBorder]}>
                      <Text style={styles.logDate}>{fmtDate(log.date)}</Text>
                      <Text style={styles.logWeight}>{fmtKg(log.weightKg)}</Text>
                      <Text style={[styles.logDelta, delta != null && delta !== 0 && {
                        color: delta < 0 === (profile?.goal !== 'gain') ? colors.success : colors.warning,
                      }]}>
                        {delta == null ? '' : delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${delta}`}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleDelete(log)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete entry from ${fmtDate(log.date)}`}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </Rise>

            {/* Profile */}
            <Rise index={6}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Profile</Text>

                <Text style={styles.fieldLabel}>SEX (FOR BMR FORMULA)</Text>
                <Segment
                  options={[{ key: 'male', label: 'Male' }, { key: 'female', label: 'Female' }]}
                  value={form.sex}
                  onChange={(v) => setField('sex', v)}
                  styles={styles}
                />

                <Text style={styles.fieldLabel}>BIRTH DATE</Text>
                <DatePickerInput
                  value={form.birthDate}
                  onChange={(v) => setField('birthDate', v)}
                  placeholder="Select"
                  accessibilityLabel="Birth date"
                />

                <Text style={styles.fieldLabel}>HEIGHT</Text>
                <View style={styles.weightField}>
                  <TextInput
                    style={styles.weightInput}
                    value={form.heightCm}
                    onChangeText={(v) => setField('heightCm', v)}
                    placeholder="175"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Height in centimeters"
                  />
                  <Text style={styles.unit}>cm</Text>
                </View>

                <Text style={styles.fieldLabel}>ACTIVITY LEVEL</Text>
                <View style={styles.chipRow}>
                  {ACTIVITY_LEVELS.map((a) => {
                    const active = form.activityLevel === a.key;
                    return (
                      <TouchableOpacity
                        key={a.key}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setField('activityLevel', a.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.hint}>
                  {ACTIVITY_LEVELS.find((a) => a.key === form.activityLevel)?.hint}
                </Text>

                <Text style={styles.fieldLabel}>GOAL</Text>
                <Segment
                  options={GOALS}
                  value={form.goal}
                  onChange={(v) => setField('goal', v)}
                  styles={styles}
                />

                {form.goal !== 'maintain' && (
                  <>
                    <Text style={styles.fieldLabel}>WEEKLY RATE</Text>
                    <View style={styles.chipRow}>
                      {WEEKLY_RATES.map((r) => {
                        const active = form.weeklyRateKg === r;
                        return (
                          <TouchableOpacity
                            key={r}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() => setField('weeklyRateKg', r)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{r} kg/week</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                <Text style={styles.fieldLabel}>GOAL WEIGHT (OPTIONAL)</Text>
                <View style={styles.weightField}>
                  <TextInput
                    style={styles.weightInput}
                    value={form.goalWeightKg}
                    onChangeText={(v) => setField('goalWeightKg', v)}
                    placeholder="—"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Goal weight in kilograms"
                  />
                  <Text style={styles.unit}>kg</Text>
                </View>

                <TouchableOpacity
                  style={[styles.primaryBtn, saving && { opacity: 0.5 }]}
                  onPress={handleSaveProfile}
                  disabled={saving}
                  accessibilityRole="button"
                >
                  {saving
                    ? <ActivityIndicator color={colors.accentForeground} />
                    : <Text style={styles.primaryBtnText}>Save profile</Text>}
                </TouchableOpacity>
              </View>
            </Rise>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function BreakdownRow({ label, value, styles, strong }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, strong && styles.breakdownStrong]}>{label}</Text>
      <Text style={[styles.breakdownValue, strong && styles.breakdownStrong]}>{value}</Text>
    </View>
  );
}

function Segment({ options, value, onChange, styles }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segBtn, active && styles.segBtnActive]}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Bar-per-weigh-in chart scaled to the visible min/max (plus goal, if set).
function WeightChart({ logs, goalWeightKg, colors, styles }) {
  const values = logs.map((l) => l.weightKg);
  if (goalWeightKg) values.push(goalWeightKg);
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const span = max - min || 1;
  const y = (kg) => ((kg - min) / span) * CHART_HEIGHT;
  const lastIdx = logs.length - 1;

  return (
    <View>
      <View style={styles.chartArea}>
        <View style={styles.chartAxis}>
          <Text style={styles.chartAxisText}>{max}</Text>
          <Text style={styles.chartAxisText}>{min}</Text>
        </View>
        <View style={[styles.chartPlot, { height: CHART_HEIGHT }]}>
          {goalWeightKg ? (
            <View style={[styles.goalLine, { bottom: y(goalWeightKg) }]} />
          ) : null}
          {logs.map((l, i) => (
            <View key={l.id} style={styles.chartCol}>
              <View style={[
                styles.chartBar,
                { height: Math.max(y(l.weightKg), 3) },
                i === lastIdx && { backgroundColor: colors.accent },
              ]} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.chartFooter}>
        <Text style={styles.chartAxisText}>{format(parseISO(logs[0].date), 'MMM d')}</Text>
        {goalWeightKg ? (
          <View style={styles.legendRow}>
            <View style={styles.legendSwatch} />
            <Text style={styles.chartAxisText}>Goal</Text>
          </View>
        ) : null}
        <Text style={styles.chartAxisText}>{format(parseISO(logs[lastIdx].date), 'MMM d')}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  title: { ...type.h3, color: colors.textPrimary },

  centerState: { alignItems: 'center', paddingVertical: spacing.huge, gap: spacing.sm },
  emptyTitle: { ...type.h3, color: colors.textSecondary },
  emptySub: { ...type.bodySm, color: colors.textTertiary },

  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  statValue: { ...type.h4, color: colors.textPrimary },
  statLabel: { ...type.caption, color: colors.textTertiary, marginTop: 2, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg,
  },
  cardTitle: { ...type.bodyMed, color: colors.textPrimary, marginBottom: spacing.xs },

  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { ...type.bodySm, color: colors.textSecondary },
  breakdownValue: { ...type.bodySm, color: colors.textPrimary },
  breakdownStrong: { fontWeight: '700', color: colors.textPrimary, fontSize: 15 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  noteText: { ...type.caption, flex: 1 },
  disclaimer: { ...type.caption, color: colors.textTertiary, marginTop: spacing.xs },

  logRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  weightField: {
    flexDirection: 'row', alignItems: 'center', height: 50, minWidth: 120,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg,
  },
  weightInput: { ...type.body, flex: 1, color: colors.textPrimary, padding: 0 },
  unit: { ...type.bodySm, color: colors.textTertiary, marginLeft: spacing.xs },

  primaryBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  primaryBtnText: { ...type.bodyMed, color: colors.accentForeground },

  chartArea: { flexDirection: 'row', gap: spacing.sm },
  chartAxis: { justifyContent: 'space-between', height: CHART_HEIGHT },
  chartAxisText: { ...type.caption, color: colors.textTertiary },
  chartPlot: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2,
    borderBottomWidth: 1, borderColor: colors.border,
  },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: {
    width: '100%', maxWidth: 14, backgroundColor: colors.accentSoft,
    borderTopLeftRadius: 3, borderTopRightRadius: 3,
  },
  goalLine: {
    position: 'absolute', left: 0, right: 0, height: 0,
    borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.success, zIndex: 1,
  },
  chartFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.xs, paddingLeft: 28,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 12, height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.success },

  goalBlock: { marginTop: spacing.md, gap: spacing.xs },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  goalLabel: { ...type.bodySm, color: colors.textPrimary, fontWeight: '600' },
  goalMeta: { ...type.caption, color: colors.textSecondary },
  progressTrack: { height: 6, borderRadius: radius.full, backgroundColor: colors.muted, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accent },

  logItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  logItemBorder: { borderTopWidth: 1, borderColor: colors.border },
  logDate: { ...type.bodySm, color: colors.textSecondary, flex: 1 },
  logWeight: { ...type.bodySm, color: colors.textPrimary, fontWeight: '600' },
  logDelta: { ...type.caption, color: colors.textTertiary, width: 40, textAlign: 'right' },

  fieldLabel: { ...type.label, color: colors.textTertiary, marginTop: spacing.sm },
  hint: { ...type.caption, color: colors.textTertiary },
  segment: {
    flexDirection: 'row', backgroundColor: colors.muted,
    borderRadius: radius.md, padding: 2,
  },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  segBtnActive: { backgroundColor: colors.surface },
  segText: { ...type.bodySm, color: colors.textTertiary, fontWeight: '600' },
  segTextActive: { color: colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: colors.muted, borderWidth: 1, borderColor: 'transparent',
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { ...type.bodySm, color: colors.textSecondary },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
});
