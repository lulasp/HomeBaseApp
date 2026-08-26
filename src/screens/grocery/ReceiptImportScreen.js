import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import DatePickerInput from '../../components/DatePickerInput';
import {
  getHouseholdWithPrivate, subscribePriceEntries, addPriceEntriesBatch,
} from '../../services/firestore';
import { parseReceipt } from '../../services/openrouter';
import {
  normalizeReceipt, matchReceiptLines, selectedTotal, toPriceEntryDocs,
} from '../../utils/receiptImport';
import {
  buildPriceHistory, recentStores, formatPrice, todayKey,
} from '../../utils/pricing';
import { DEFAULT_AI_MODEL, getAiModel, visionModels } from '../../utils/aiModels';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

// Read a picked file's bytes as base64. Works on web (blob: URI) and native
// (file:// URI) — mirrors StatementImportScreen, avoiding expo-file-system,
// which has no web implementation.
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

// ── Reviewed line ──────────────────────────────────────────────────────────────

function LineRow({ line, index, onToggle, onChange, colors, styles }) {
  return (
    <View style={[styles.lineRow, !line.include && styles.lineRowExcluded]}>
      <TouchableOpacity
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.include }}
        accessibilityLabel={`${line.name}, ${line.include ? 'included' : 'excluded'}`}
      >
        <View style={[styles.checkbox, line.include && styles.checkboxChecked]}>
          {line.include && <Ionicons name="checkmark" size={12} color="#fff" />}
        </View>
      </TouchableOpacity>

      <View style={{ flex: 1, gap: 4 }}>
        <TextInput
          style={styles.lineName}
          value={line.name}
          onChangeText={(name) => onChange(index, { name })}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={`Name for line ${index + 1}`}
        />
        <View style={styles.lineTags}>
          {line.matchedItem ? (
            <View style={[styles.tag, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.tagLabel, { color: colors.success }]}>
                {line.matchedItem.itemName}
              </Text>
            </View>
          ) : (
            <View style={[styles.tag, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.tagLabel, { color: colors.accent }]}>New item</Text>
            </View>
          )}
          {line.lastPrice != null && (
            <Text style={styles.lineHint}>last {formatPrice(line.lastPrice)}</Text>
          )}
          {line.unitMismatch && (
            <Text style={[styles.lineHint, { color: colors.warning }]}>different unit</Text>
          )}
        </View>
      </View>

      <View style={styles.lineNumbers}>
        <TextInput
          style={styles.lineQty}
          value={String(line.quantity)}
          onChangeText={(v) => onChange(index, { quantity: v.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
          accessibilityLabel={`Quantity for ${line.name}`}
        />
        <Text style={styles.lineUnit}>{line.unit}</Text>
      </View>

      <TextInput
        style={styles.linePrice}
        value={String(line.price)}
        onChangeText={(v) => onChange(index, { price: v.replace(/[^0-9.]/g, '') })}
        keyboardType="decimal-pad"
        accessibilityLabel={`Price for ${line.name}`}
      />
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function ReceiptImportScreen({ navigation }) {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const { notify } = useNotification();
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navScrollProps = useNavScrollProps();

  const [apiKey, setApiKey]   = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [entries, setEntries] = useState([]);

  const [file, setFile]           = useState(null);   // { uri, name, mimeType }
  const [analyzing, setAnalyzing] = useState(false);
  const [lines, setLines]         = useState(null);   // null = not analyzed yet
  const [store, setStore]         = useState('');
  const [date, setDate]           = useState('');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!householdId) return;
    getHouseholdWithPrivate(householdId).then((hh) => {
      setApiKey(hh?.openRouterApiKey ?? '');
      setAiModel(hh?.aiModel ?? DEFAULT_AI_MODEL);
    }).catch(() => { /* surfaced when analyzing */ });
    return subscribePriceEntries(householdId, setEntries);
  }, [householdId]);

  const history = useMemo(() => buildPriceHistory(entries), [entries]);
  const stores  = useMemo(() => recentStores(entries, 12), [entries]);

  const model     = getAiModel(aiModel);
  const isPdf     = /pdf/i.test(file?.mimeType || '');
  const needsVision = !!file && !isPdf && !model?.vision;

  const total = useMemo(() => selectedTotal(lines ?? []), [lines]);
  const includedCount = (lines ?? []).filter((l) => l.include).length;

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      setFile(res.assets[0]);
      setLines(null);
    } catch {
      showAlert({ title: 'Could not open file', message: 'Please try selecting the receipt again.', type: 'error' });
    }
  };

  const analyze = async () => {
    if (!file) return;
    if (!apiKey) {
      showAlert({
        title: 'No API key',
        message: 'Add an OpenRouter API key in Household settings to scan receipts.',
        type: 'error',
      });
      return;
    }
    setAnalyzing(true);
    try {
      const base64 = await uriToBase64(file.uri);
      const parsed = await parseReceipt(apiKey, { base64, mimeType: file.mimeType }, aiModel);
      const receipt = normalizeReceipt(parsed);
      if (!receipt.lines.length) {
        showAlert({
          title: 'Nothing found',
          message: 'No product lines could be read from that receipt. Try a sharper photo or a PDF.',
          type: 'warning',
        });
        return;
      }
      setLines(matchReceiptLines(receipt.lines, history));
      setStore(receipt.store || stores[0] || '');
      setDate(receipt.date || todayKey());
    } catch (e) {
      showAlert({ title: 'Could not read receipt', message: e.message, type: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const toggleLine = (index) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, include: !line.include } : line)));
  };

  const save = async () => {
    const docs = toPriceEntryDocs(lines, { store, date, addedBy: user.uid });
    if (!docs.length) {
      showAlert({ title: 'Nothing to import', message: 'Select at least one line with a valid price.', type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await addPriceEntriesBatch(householdId, docs);
      notify('Receipt imported', `${docs.length} price${docs.length !== 1 ? 's' : ''} logged from ${store || 'this receipt'}.`, { type: 'success' });
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.root,
        Platform.OS === 'android' && { paddingTop: 24 },
        // Web: pin to the viewport so the ScrollView has a real bounded height.
        Platform.OS === 'web' && { height: windowHeight },
      ]}
    >
      <ScrollView
        style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
        contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...navScrollProps}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Scan receipt</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Pick + analyze */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.pickButton} onPress={pickFile} accessibilityRole="button">
            <Ionicons name="receipt-outline" size={18} color={colors.accent} />
            <Text style={styles.pickButtonLabel} numberOfLines={1}>
              {file ? file.name : 'Choose a receipt photo or PDF'}
            </Text>
          </TouchableOpacity>

          {needsVision && (
            <Text style={styles.warnText}>
              {model?.label ?? 'The selected model'} can't read images. Switch to{' '}
              {visionModels().map((m) => m.label).join(' or ')} in Household settings, or pick a PDF.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, (!file || analyzing || needsVision) && styles.buttonDisabled]}
            onPress={analyze}
            disabled={!file || analyzing || needsVision}
            accessibilityRole="button"
          >
            {analyzing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryButtonLabel}>Read receipt</Text>}
          </TouchableOpacity>
          <Text style={styles.hintText}>
            Lines are read by AI and always shown for review — nothing is saved until you confirm.
          </Text>
        </View>

        {/* Review */}
        {lines && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Shop details</Text>
              <Text style={styles.inputLabel}>Store</Text>
              <TextInput
                style={styles.textInput}
                value={store}
                onChangeText={setStore}
                placeholder="e.g. Lidl"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Store"
              />
              {stores.length > 0 && (
                <View style={styles.chipRow}>
                  {stores.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, store === s && styles.chipActive]}
                      onPress={() => setStore(s)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: store === s }}
                    >
                      <Text style={[styles.chipLabel, store === s && styles.chipLabelActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.inputLabel}>Purchase date</Text>
              <DatePickerInput value={date} onChange={setDate} />
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Lines</Text>
                <Text style={styles.cardHint}>{includedCount} of {lines.length} selected</Text>
              </View>
              {lines.map((line, i) => (
                <LineRow
                  key={`${line.itemKey}-${i}`}
                  line={line}
                  index={i}
                  onToggle={() => toggleLine(i)}
                  onChange={updateLine}
                  colors={colors}
                  styles={styles}
                />
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Selected total</Text>
                <Text style={styles.totalValue}>{formatPrice(total)}</Text>
              </View>
              <Text style={styles.hintText}>
                Compare this against the receipt's printed total to spot a misread line.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.buttonDisabled]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryButtonLabel}>
                    Import {includedCount} price{includedCount !== 1 ? 's' : ''}
                  </Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  container: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
    paddingBottom: 230, gap: spacing.md,
  },
  containerDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title:  { ...type.h3, color: colors.textPrimary, flex: 1 },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle:  { ...type.h4, color: colors.textPrimary },
  cardHint:   { ...type.caption, color: colors.textTertiary },

  pickButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.lg, height: 50,
  },
  pickButtonLabel: { ...type.body, color: colors.textPrimary, flex: 1 },

  primaryButton: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  primaryButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },
  buttonDisabled:     { opacity: 0.45 },

  hintText: { ...type.caption, color: colors.textTertiary },
  warnText: { ...type.caption, color: colors.warning },

  inputLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },

  // Wrapping View rather than a nested horizontal ScrollView — a nested
  // horizontal scroll blocks the outer vertical scroll on web.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipLabel:       { ...type.label, color: colors.textSecondary },
  chipLabelActive: { color: colors.accent },

  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border,
  },
  lineRowExcluded: { opacity: 0.45 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  lineName: {
    ...type.bodyMed, color: colors.textPrimary,
    paddingVertical: 2, paddingHorizontal: 0,
  },
  lineTags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full },
  tagLabel:  { ...type.caption, fontWeight: '700' },
  lineHint:  { ...type.caption, color: colors.textTertiary },

  lineNumbers: { alignItems: 'center', width: 54 },
  lineQty: {
    ...type.bodySm, color: colors.textPrimary, textAlign: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.border,
    minWidth: 40, paddingVertical: 2,
  },
  lineUnit: { ...type.caption, color: colors.textTertiary },
  linePrice: {
    ...type.bodyMed, color: colors.textPrimary, textAlign: 'right',
    borderBottomWidth: 1, borderBottomColor: colors.border,
    width: 64, paddingVertical: 2,
  },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md,
  },
  totalLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  totalValue: { ...type.h4, color: colors.textPrimary },
});
