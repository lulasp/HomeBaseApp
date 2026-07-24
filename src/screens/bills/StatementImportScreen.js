import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import {
  getHouseholdWithPrivate, subscribeExpenses, addExpensesBatch, addBill,
} from '../../services/firestore';
import { parseBankStatement, parseStatementText } from '../../services/openrouter';
import {
  normalizeTransaction, flagDuplicates, toExpenseDoc, toBillDoc,
} from '../../utils/statementImport';
import { xlsxBase64ToCsv, isSpreadsheet } from '../../utils/spreadsheet';
import { DEFAULT_AI_MODEL } from '../../utils/aiModels';
import { BILL_CATS, EXPENSE_CATS, withCustomCats } from '../../utils/financeCategories';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

function fmtCurrency(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Persisted review draft — survives leaving the screen (and page reloads on web)
// so an analyzed-but-not-imported statement isn't lost.
const draftKey = (householdId) => `statementImportDraft:${householdId}`;

// Read a picked file's bytes as base64. Works on web (blob: URI) and native
// (file:// URI) — avoids expo-file-system, which has no web implementation.
function uriToBase64(uri) {
  return fetch(uri)
    .then((res) => res.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.onload = () => {
        const result = String(reader.result);      // "data:<mime>;base64,XXXX"
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    }));
}

// ── Category chip ──────────────────────────────────────────────────────────────

function CatChip({ cat, selected, onPress, colors }) {
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 6,
        borderRadius: radius.full, borderWidth: 1,
        borderColor: selected ? iconColor : colors.border,
        backgroundColor: selected ? iconColor + '22' : colors.surfaceElevated,
      }}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {cat.isCustom
        ? <Text style={{ fontSize: 12, lineHeight: 16 }}>{cat.icon}</Text>
        : <Ionicons name={cat.icon} size={13} color={iconColor} />}
      <Text style={[type.caption, { fontWeight: '600', color: selected ? iconColor : colors.textSecondary }]}>
        {cat.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Review row ─────────────────────────────────────────────────────────────────

function ReviewRow({ row, index, onChange, expenseCats, billCats, colors, styles }) {
  const cats = row.type === 'bill' ? billCats : expenseCats;
  const dateLabel = row.date ? format(new Date(row.date + 'T00:00:00'), 'MMM d') : 'No date';
  const isIncome = row.direction === 'in';

  const set = (patch) => onChange(index, patch);

  return (
    <View style={[styles.row, !row.include && { opacity: 0.5 }]}>
      <View style={styles.rowTop}>
        <TouchableOpacity
          onPress={() => set({ include: !row.include })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.include }}
        >
          <Ionicons
            name={row.include ? 'checkbox' : 'square-outline'}
            size={22}
            color={row.include ? colors.accent : colors.textTertiary}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <TextInput
            style={styles.rowTitle}
            value={row.description}
            onChangeText={(t) => set({ description: t })}
            placeholder="Description"
            placeholderTextColor={colors.textTertiary}
          />
          <View style={styles.rowMeta}>
            <Ionicons name="calendar-outline" size={11} color={colors.textTertiary} />
            <Text style={styles.rowDate}>{dateLabel}</Text>
            {row.duplicate && (
              <View style={styles.dupPill}>
                <Ionicons name="copy-outline" size={10} color={colors.amber} />
                <Text style={styles.dupText}>Possible duplicate</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.amountCol}>
          <View style={styles.amountRow}>
            <Text style={[styles.amountSign, { color: isIncome ? colors.sage : colors.textPrimary }]}>
              {isIncome ? '+' : ''}$
            </Text>
            <TextInput
              style={[styles.amountInput, { color: isIncome ? colors.sage : colors.textPrimary }]}
              value={String(row.amount)}
              onChangeText={(t) => set({ amount: Number(t.replace(/[^0-9.]/g, '')) || 0 })}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
      </View>

      {/* toggles */}
      <View style={styles.toggleRow}>
        <View style={styles.segment}>
          {[['out', 'Spent'], ['in', 'Income']].map(([val, label]) => (
            <TouchableOpacity
              key={val}
              style={[styles.segBtn, row.direction === val && styles.segBtnActive]}
              onPress={() => set({ direction: val })}
            >
              <Text style={[styles.segText, row.direction === val && styles.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.segment}>
          {[['expense', 'Expense'], ['bill', 'Bill']].map(([val, label]) => (
            <TouchableOpacity
              key={val}
              style={[styles.segBtn, row.type === val && styles.segBtnActive]}
              onPress={() => set({ type: val, category: 'other' })}
            >
              <Text style={[styles.segText, row.type === val && styles.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* category chips — wrapping row (a nested horizontal ScrollView would
          block the outer list from scrolling on web) */}
      <View style={styles.chipRow}>
        {cats.map((cat) => (
          <CatChip
            key={cat.key}
            cat={cat}
            selected={row.category === cat.key}
            onPress={() => set({ category: cat.key })}
            colors={colors}
          />
        ))}
      </View>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function StatementImportScreen({ navigation }) {
  const { householdId, displayName } = useAuth();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const { notify } = useNotification();
  const isDesktop = useIsDesktop();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [customBillCats, setCustomBillCats] = useState([]);
  const [customExpCats, setCustomExpCats] = useState([]);
  const [existingExpenses, setExistingExpenses] = useState([]);
  const [apiKey, setApiKey] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);

  const [file, setFile] = useState(null);       // { uri, name }
  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState(null);        // null = not analyzed yet
  const [saving, setSaving] = useState(false);

  const expenseCats = useMemo(() => withCustomCats(EXPENSE_CATS, customExpCats), [customExpCats]);
  const billCats    = useMemo(() => withCustomCats(BILL_CATS, customBillCats), [customBillCats]);

  useEffect(() => {
    if (!householdId) return;
    getHouseholdWithPrivate(householdId).then((hh) => {
      setCustomBillCats(hh?.billCustomCategories ?? []);
      setCustomExpCats(hh?.expenseCustomCategories ?? []);
      setApiKey(hh?.openRouterApiKey ?? '');
      setAiModel(hh?.aiModel ?? DEFAULT_AI_MODEL);
    });
    return subscribeExpenses(householdId, setExistingExpenses);
  }, [householdId]);

  // Restore a previously analyzed (but not imported) statement.
  useEffect(() => {
    if (!householdId) return;
    let active = true;
    AsyncStorage.getItem(draftKey(householdId)).then((raw) => {
      if (!active || !raw) return;
      try {
        const draft = JSON.parse(raw);
        if (draft?.rows?.length) {
          setRows(draft.rows);
          if (draft.fileName) setFile({ name: draft.fileName }); // no uri: re-analyze needs a re-pick
        }
      } catch { /* ignore corrupt draft */ }
    });
    return () => { active = false; };
  }, [householdId]);

  // Persist the review list as it changes so it survives navigation / reload.
  useEffect(() => {
    if (!householdId) return;
    if (rows && rows.length) {
      AsyncStorage.setItem(draftKey(householdId), JSON.stringify({ fileName: file?.name, rows }));
    }
  }, [rows, householdId, file?.name]);

  const clearDraft = () => {
    if (householdId) AsyncStorage.removeItem(draftKey(householdId));
    setRows(null);
    setFile(null);
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      setFile(res.assets[0]);
      setRows(null);
    } catch (e) {
      showAlert({ title: 'Could not open file', message: 'Please try selecting the file again.', type: 'error' });
    }
  };

  const analyze = async () => {
    if (!file) return;
    if (!apiKey) {
      showAlert({ title: 'AI not configured', message: 'Add an OpenRouter API key in Household settings to import statements.', type: 'info' });
      return;
    }
    setAnalyzing(true);
    try {
      const base64 = await uriToBase64(file.uri);
      const cats = { expenseCats: EXPENSE_CATS, billCats: BILL_CATS };
      const { transactions } = isSpreadsheet(file)
        ? await parseStatementText(apiKey, xlsxBase64ToCsv(base64), cats, aiModel)
        : await parseBankStatement(apiKey, base64, cats, aiModel);
      const validKeys = [...expenseCats, ...billCats].map((c) => c.key);
      const normalized = (transactions ?? []).map((t) =>
        normalizeTransaction(t, { validCategoryKeys: validKeys }));
      const flagged = flagDuplicates(normalized, existingExpenses);
      setRows(flagged.map((r) => ({ ...r, include: !r.duplicate })));
      if (!flagged.length) {
        showAlert({
          title: 'No transactions found',
          message: 'The AI could not read any transactions from this statement.',
          type: 'warning',
        });
      }
    } catch (e) {
      showAlert({ title: 'Analysis failed', message: e.message || 'Could not read this statement.', type: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const updateRow = (index, patch) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const selected = useMemo(() => (rows ?? []).filter((r) => r.include), [rows]);
  const counts = useMemo(() => ({
    expenses: selected.filter((r) => r.type === 'expense').length,
    bills:    selected.filter((r) => r.type === 'bill').length,
    income:   selected.filter((r) => r.direction === 'in').length,
  }), [selected]);

  const confirmImport = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      const expenseDocs = selected
        .filter((r) => r.type === 'expense')
        .map((r) => toExpenseDoc(r, { paidBy: displayName || '' }));
      const billRows = selected.filter((r) => r.type === 'bill');

      await addExpensesBatch(householdId, expenseDocs);
      await Promise.all(billRows.map((r) => addBill(householdId, toBillDoc(r))));

      await AsyncStorage.removeItem(draftKey(householdId));
      notify(
        'Statement imported',
        `${expenseDocs.length} expense${expenseDocs.length === 1 ? '' : 's'}` +
          (billRows.length ? ` · ${billRows.length} bill${billRows.length === 1 ? '' : 's'}` : ''),
        { type: 'success' },
      );
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Import failed', message: e.message || 'Could not save the transactions.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const contentWidth = isDesktop
    ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }
    : null;

  return (
    <SafeAreaView
      style={[
        styles.root,
        Platform.OS === 'android' && { paddingTop: 24 },
        // On web the ancestor height chain doesn't reliably bound this screen,
        // so pin it to the viewport height — gives the ScrollView a real height
        // to scroll within instead of growing to fit all content.
        Platform.OS === 'web' && { height: windowHeight },
      ]}
    >
      <ScrollView
        // Web: explicit pixel height (not flex:1) so the scroll container has a
        // real, bounded height regardless of the ancestor flex chain.
        style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
        contentContainerStyle={[styles.container, contentWidth]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Import statement</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Pick + analyze */}
        <View style={styles.pickCard}>
          <TouchableOpacity style={styles.pickBtn} onPress={pickFile} accessibilityRole="button">
            <Ionicons name={file ? 'document-text' : 'cloud-upload-outline'} size={22} color={colors.accent} />
            <Text style={styles.pickBtnText} numberOfLines={1}>
              {file ? file.name : 'Choose a PDF or Excel bank statement'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.privacyNote}>
            Statement data is sent to OpenRouter (your configured AI model) to extract transactions.
          </Text>
          {!!file?.uri && (
            <TouchableOpacity
              style={[styles.analyzeBtn, analyzing && { opacity: 0.6 }]}
              onPress={analyze}
              disabled={analyzing}
              accessibilityRole="button"
            >
              {analyzing
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.analyzeBtnText}>{rows ? 'Re-analyze' : 'Analyze statement'}</Text>}
            </TouchableOpacity>
          )}
          {rows !== null && (
            <TouchableOpacity onPress={clearDraft} accessibilityRole="button" style={styles.discardBtn}>
              <Ionicons name="trash-outline" size={14} color={colors.danger} />
              <Text style={styles.discardText}>Discard & start over</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Empty / loading hint */}
        {rows === null && !analyzing && (
          <View style={styles.emptyState}>
            <Ionicons name="reader-outline" size={44} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No statement analyzed yet</Text>
            <Text style={styles.emptySub}>
              Pick a PDF or Excel file and tap Analyze. You'll review every transaction before anything is saved.
            </Text>
          </View>
        )}

        {/* Review list */}
        {rows !== null && rows.length > 0 && (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{selected.length}</Text>
                <Text style={styles.summaryLabel}>To import</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: colors.accent }]}>{counts.bills}</Text>
                <Text style={styles.summaryLabel}>Bills</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: colors.sage }]}>{counts.income}</Text>
                <Text style={styles.summaryLabel}>Income</Text>
              </View>
            </View>

            <View style={styles.list}>
              {rows.map((row, i) => (
                <ReviewRow
                  key={i}
                  row={row}
                  index={i}
                  onChange={updateRow}
                  expenseCats={expenseCats}
                  billCats={billCats}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>

            {/* Import action — in-flow so it aligns with the list and avoids
                the sidebar/absolute-positioning issues on web */}
            <TouchableOpacity
              style={[styles.confirmBtn, (!selected.length || saving) && { opacity: 0.5 }]}
              onPress={confirmImport}
              disabled={!selected.length || saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.confirmBtnText}>
                    Import {selected.length} transaction{selected.length === 1 ? '' : 's'}
                  </Text>}
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  title: { ...type.h3, color: colors.textPrimary },
  container: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },

  pickCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.md, marginBottom: spacing.lg,
  },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed',
    borderRadius: radius.md, padding: spacing.md,
  },
  pickBtnText: { ...type.body, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  privacyNote: { ...type.caption, color: colors.textTertiary },
  analyzeBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  analyzeBtnText: { ...type.body, color: '#fff', fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm },
  emptyTitle: { ...type.h3, color: colors.textSecondary },
  emptySub: { ...type.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },

  summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  summaryCard: {
    flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  summaryValue: { ...type.h2, color: colors.textPrimary },
  summaryLabel: { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  list: { gap: spacing.md },
  row: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { ...type.body, color: colors.textPrimary, fontWeight: '600', padding: 0 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  rowDate: { ...type.caption, color: colors.textTertiary },
  dupPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.amberSoft, borderRadius: radius.full,
    paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4,
  },
  dupText: { ...type.caption, color: colors.amber, fontWeight: '600', fontSize: 10 },
  amountCol: { alignItems: 'flex-end' },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  amountSign: { ...type.body, fontWeight: '700' },
  amountInput: { ...type.body, fontWeight: '700', minWidth: 60, textAlign: 'right', padding: 0 },

  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flexDirection: 'row', backgroundColor: colors.muted,
    borderRadius: radius.md, padding: 2, flex: 1,
  },
  segBtn: { flex: 1, paddingVertical: 5, alignItems: 'center', borderRadius: radius.sm },
  segBtnActive: { backgroundColor: colors.surfaceElevated },
  segText: { ...type.caption, color: colors.textTertiary, fontWeight: '600' },
  segTextActive: { color: colors.textPrimary },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 2 },

  confirmBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center',
    marginTop: spacing.lg,
  },
  discardBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.sm,
  },
  discardText: { ...type.caption, color: colors.danger, fontWeight: '600' },
  confirmBtnText: { ...type.body, color: '#fff', fontWeight: '700' },
});
