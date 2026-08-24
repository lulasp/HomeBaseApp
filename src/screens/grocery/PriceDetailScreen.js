import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import DatePickerInput from '../../components/DatePickerInput';
import {
  subscribePriceEntries, deletePriceEntry, deletePriceEntriesForItem,
  updatePriceEntry, getHousehold,
} from '../../services/firestore';
import {
  buildPriceHistory, buildPriceEntryPatch, recentStores,
  formatPrice, formatUnitPrice, formatPercent, trendPresentation,
} from '../../utils/pricing';
import { UNITS } from '../../utils/categories';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

const CHART_HEIGHT = 120;
const MAX_BARS = 24;

const fmtDate = (iso) => {
  if (!iso) return '';
  try { return format(parseISO(iso), 'd MMM yyyy'); } catch { return iso; }
};

// ── Price-over-time bars ───────────────────────────────────────────────────────
// Plain Views rather than a chart library: the data is a short, single series
// and this keeps the bundle free of a native SVG dependency.
function PriceChart({ entries, canonicalUnit, colors, styles }) {
  const shown = entries.slice(-MAX_BARS);
  const prices = shown.map((e) => Number(e.unitPrice)).filter(Number.isFinite);
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Unit price over time</Text>
        <Text style={styles.cardHint}>per {canonicalUnit}</Text>
      </View>

      <View style={styles.chartRow} accessibilityLabel={`Price history chart, ${shown.length} entries`}>
        {shown.map((entry, i) => {
          const price = Number(entry.unitPrice);
          // Flat series (span 0) would divide by zero — draw them all mid-height.
          const ratio = span > 0 ? (price - min) / span : 0.5;
          const isLast = i === shown.length - 1;
          const isLow  = price === min;
          const barColor = isLast ? colors.accent : isLow ? colors.success : colors.borderStrong;
          return (
            <View key={entry.id ?? i} style={styles.chartBarSlot}>
              <View
                style={[
                  styles.chartBar,
                  // Floor at 8% so the cheapest entry stays visible as a bar.
                  { height: Math.max(CHART_HEIGHT * (0.08 + ratio * 0.92), 4), backgroundColor: barColor },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.chartAxis}>
        <Text style={styles.chartAxisLabel}>{fmtDate(shown[0].purchasedAt)}</Text>
        <Text style={styles.chartAxisLabel}>{fmtDate(shown[shown.length - 1].purchasedAt)}</Text>
      </View>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function PriceDetailScreen() {
  const { householdId } = useAuth();
  const { colors } = useTheme();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const navigation = useNavigation();
  const route = useRoute();
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navScrollProps = useNavScrollProps();

  const itemKey = route.params?.itemKey;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState(UNITS);

  // Entry being edited, plus its in-progress form values.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    return subscribePriceEntries(householdId, (rows) => {
      setEntries(rows);
      setLoading(false);
    });
  }, [householdId]);

  // Household unit config, so the edit sheet offers the same units as the
  // grocery list rather than only the built-in defaults.
  useEffect(() => {
    if (!householdId) return;
    let active = true;
    getHousehold(householdId).then((hh) => {
      if (!active) return;
      setUnits([...(hh?.enabledUnits ?? UNITS), ...(hh?.customUnits ?? [])]);
    }).catch(() => { /* falls back to defaults */ });
    return () => { active = false; };
  }, [householdId]);

  const item = useMemo(() => {
    const forItem = entries.filter((e) => e.itemKey === itemKey);
    return buildPriceHistory(forItem)[0] ?? null;
  }, [entries, itemKey]);

  const storeSuggestions = useMemo(() => recentStores(entries), [entries]);

  // What the edited values will store as a unit price — shown live so a unit or
  // quantity change makes its effect on the comparison obvious before saving.
  const previewUnitPrice = useMemo(() => {
    if (!form) return null;
    const patch = buildPriceEntryPatch(form);
    return patch ? formatUnitPrice(patch.unitPrice, patch.canonicalUnit) : null;
  }, [form]);

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({
      price:       String(entry.price ?? ''),
      quantity:    String(entry.quantity ?? '1'),
      unit:        entry.unit || 'pcs',
      store:       entry.store || '',
      purchasedAt: entry.purchasedAt || '',
    });
    setErrors({});
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(null);
    setErrors({});
  };

  const handleSaveEdit = async () => {
    if (!editing || !form) return;
    const errs = {};
    if (!form.price.trim() || !(Number(form.price) > 0)) errs.price = 'Enter a price';
    if (form.quantity.trim() && !(Number(form.quantity) > 0)) errs.quantity = 'Must be > 0';
    if (form.purchasedAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(form.purchasedAt.trim()))
      errs.purchasedAt = 'Use YYYY-MM-DD format';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const patch = buildPriceEntryPatch(form);
    if (!patch) { setErrors({ price: 'Enter a price' }); return; }

    setSaving(true);
    try {
      await updatePriceEntry(householdId, editing.id, patch);
      notify('Entry updated', `${item.itemName} · ${formatPrice(patch.price)}`, { type: 'success' });
      closeEdit();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async (entry) => {
    const confirmed = await showConfirm({
      title: 'Delete entry',
      message: `Remove the ${formatPrice(entry.price)} entry from ${fmtDate(entry.purchasedAt)}?`,
      type: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await deletePriceEntry(householdId, entry.id);
      notify('Entry deleted', 'Price history updated.', { type: 'info' });
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const handleDeleteAll = async () => {
    const confirmed = await showConfirm({
      title: 'Delete history',
      message: `Remove all ${item.count} price entries for "${item.itemName}"?`,
      type: 'danger',
      confirmLabel: 'Delete all',
    });
    if (!confirmed) return;
    try {
      await deletePriceEntriesForItem(householdId, itemKey);
      notify('History deleted', `${item.itemName} price history removed.`, { type: 'info' });
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{item?.itemName ?? 'Price history'}</Text>
      {item ? (
        <TouchableOpacity
          onPress={handleDeleteAll}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Delete all price history for this item"
        >
          <Ionicons name="trash-outline" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : <View style={{ width: 20 }} />}
    </View>
  );

  if (!item) {
    return (
      <SafeAreaView style={[styles.root, Platform.OS === 'web' && { height: windowHeight }]}>
        <View style={[styles.container, isDesktop && styles.containerDesktop]}>
          {header}
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={loading ? 'hourglass-outline' : 'pricetag-outline'}
                size={34}
                color={colors.textTertiary}
              />
            </View>
            <Text style={styles.emptyTitle}>{loading ? 'Loading…' : 'No price history'}</Text>
            <Text style={styles.emptySubtitle}>
              {loading ? '' : 'Nothing has been logged for this item yet.'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const trend = trendPresentation(item.trend.direction);
  const trendColor = colors[trend.colorKey];
  const { previous } = item.trend;

  return (
    <SafeAreaView
      style={[
        styles.root,
        // Web: the ancestor flex chain doesn't bound this screen, so pin it to
        // the viewport height and give the ScrollView a real height to scroll in.
        Platform.OS === 'web' && { height: windowHeight },
      ]}
    >
      <ScrollView
        style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
        contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
        showsVerticalScrollIndicator={false}
        {...navScrollProps}
      >
        {header}

        {/* Current price + how it moved */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Last paid</Text>
          <Text style={styles.heroPrice}>{formatPrice(item.latest.price)}</Text>
          <Text style={styles.heroMeta}>
            {item.latest.quantity} {item.latest.unit} · {formatUnitPrice(item.latest.unitPrice, item.canonicalUnit)}
          </Text>
          <Text style={styles.heroMeta}>
            {fmtDate(item.latest.purchasedAt)}{item.latest.store ? ` · ${item.latest.store}` : ''}
          </Text>

          <View style={[styles.trendBanner, { backgroundColor: `${trendColor}1A`, borderColor: `${trendColor}55` }]}>
            <Ionicons name={trend.icon} size={16} color={trendColor} />
            <Text style={[styles.trendBannerText, { color: trendColor }]}>
              {item.trend.direction === 'new'
                ? 'First price recorded'
                : item.trend.direction === 'same'
                  ? 'Same as last time'
                  : `${formatPercent(item.trend.pct)} ${item.trend.direction === 'up' ? 'more expensive' : 'cheaper'} than last time`}
            </Text>
          </View>

          {previous && item.trend.direction !== 'new' && (
            <Text style={styles.heroCompare}>
              Previously {formatUnitPrice(previous.unitPrice, item.canonicalUnit)} on {fmtDate(previous.purchasedAt)}
              {previous.store ? ` at ${previous.store}` : ''}
            </Text>
          )}
        </View>

        {/* Low / average / high, all per canonical unit */}
        <View style={styles.statRow}>
          {[
            { label: 'Lowest',  value: item.low,     color: colors.success },
            { label: 'Average', value: item.average, color: colors.textPrimary },
            { label: 'Highest', value: item.high,    color: colors.danger },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={[styles.statValue, { color: stat.color }]}>
                {formatUnitPrice(stat.value, item.canonicalUnit)}
              </Text>
            </View>
          ))}
        </View>

        <PriceChart
          entries={item.comparable}
          canonicalUnit={item.canonicalUnit}
          colors={colors}
          styles={styles}
        />

        {/* Where it's cheapest */}
        {item.stores.length > 1 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>By store</Text>
              <Text style={styles.cardHint}>cheapest first</Text>
            </View>
            {item.stores.map((store, i) => (
              <View key={store.store ?? 'unknown'} style={styles.storeRow}>
                <View style={[styles.storeRank, i === 0 && { backgroundColor: colors.successSoft }]}>
                  <Text style={[styles.storeRankText, i === 0 && { color: colors.success }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{store.store ?? 'Unspecified store'}</Text>
                  <Text style={styles.storeMeta}>
                    {store.count} {store.count === 1 ? 'purchase' : 'purchases'} · low {formatUnitPrice(store.low, item.canonicalUnit)}
                  </Text>
                </View>
                <Text style={[styles.storeAvg, i === 0 && { color: colors.success }]}>
                  {formatUnitPrice(store.average, item.canonicalUnit)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Raw entries, newest first */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>All entries</Text>
            <Text style={styles.cardHint}>{item.count}</Text>
          </View>
          {[...item.entries].reverse().map((entry) => (
            <TouchableOpacity
              key={entry.id}
              style={styles.entryRow}
              onPress={() => openEdit(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${formatPrice(entry.price)} entry from ${fmtDate(entry.purchasedAt)}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.entryPrice}>
                  {formatPrice(entry.price)}
                  <Text style={styles.entryQty}>  {entry.quantity} {entry.unit}</Text>
                </Text>
                <Text style={styles.entryMeta}>
                  {fmtDate(entry.purchasedAt)}{entry.store ? ` · ${entry.store}` : ''}
                  {entry.canonicalUnit !== item.canonicalUnit ? ' · different unit' : ''}
                </Text>
              </View>
              <Text style={styles.entryUnitPrice}>
                {formatUnitPrice(entry.unitPrice, entry.canonicalUnit)}
              </Text>
              <View style={styles.entryActions}>
                <Ionicons name="pencil-outline" size={15} color={colors.textTertiary} />
                <TouchableOpacity
                  onPress={() => handleDeleteEntry(entry)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${formatPrice(entry.price)} entry from ${fmtDate(entry.purchasedAt)}`}
                >
                  <Ionicons name="close" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent statusBarTranslucent onRequestClose={closeEdit}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeEdit} />
          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {!!form && (
              <View style={styles.sheetInner}>
                <View style={styles.dragHandle} />
                <Text style={styles.sheetTitle}>Edit Entry</Text>
                <Text style={styles.sheetSubtitle}>{item.itemName}</Text>

                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Price *</Text>
                    <TextInput
                      style={[styles.textInput, !!errors.price && styles.inputError]}
                      placeholder="0.00"
                      value={form.price}
                      onChangeText={(price) => setForm((f) => ({ ...f, price: price.replace(/[^0-9.]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel="Price"
                    />
                    {!!errors.price && <Text style={styles.errorText}>{errors.price}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Quantity</Text>
                    <TextInput
                      style={[styles.textInput, !!errors.quantity && styles.inputError]}
                      placeholder="1"
                      value={form.quantity}
                      onChangeText={(quantity) => setForm((f) => ({ ...f, quantity: quantity.replace(/[^0-9.]/g, '') }))}
                      keyboardType="decimal-pad"
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel="Quantity"
                    />
                    {!!errors.quantity && <Text style={styles.errorText}>{errors.quantity}</Text>}
                  </View>
                </View>

                {/* Live preview: the number the comparison actually uses. */}
                <Text style={styles.previewText}>
                  {previewUnitPrice
                    ? `Compares as ${previewUnitPrice}`
                    : 'Enter a price to see the per-unit value'}
                </Text>

                <Text style={styles.inputLabel}>Unit</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {units.map((unit) => (
                    <TouchableOpacity
                      key={unit}
                      style={[styles.chip, form.unit === unit && styles.chipActive]}
                      onPress={() => setForm((f) => ({ ...f, unit }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: form.unit === unit }}
                    >
                      <Text style={[styles.chipLabel, form.unit === unit && styles.chipLabelActive]}>{unit}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.inputLabel}>Store</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Lidl"
                  value={form.store}
                  onChangeText={(store) => setForm((f) => ({ ...f, store }))}
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Store"
                />
                {storeSuggestions.length > 0 && (
                  <View style={styles.chipWrapRow}>
                    {storeSuggestions.map((store) => (
                      <TouchableOpacity
                        key={store}
                        style={[styles.chipWrap, form.store === store && styles.chipActive]}
                        onPress={() => setForm((f) => ({ ...f, store }))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: form.store === store }}
                      >
                        <Text style={[styles.chipLabel, form.store === store && styles.chipLabelActive]}>{store}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.inputLabel}>Purchase Date</Text>
                <DatePickerInput
                  value={form.purchasedAt}
                  onChange={(purchasedAt) => {
                    setForm((f) => ({ ...f, purchasedAt }));
                    if (errors.purchasedAt) setErrors((e) => ({ ...e, purchasedAt: null }));
                  }}
                  hasError={!!errors.purchasedAt}
                />
                {!!errors.purchasedAt && <Text style={styles.errorText}>{errors.purchasedAt}</Text>}

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButton} onPress={closeEdit}>
                    <Text style={styles.cancelButtonLabel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButton, saving && styles.confirmButtonDisabled]}
                    disabled={saving}
                    onPress={handleSaveEdit}
                  >
                    <Text style={styles.confirmButtonLabel}>{saving ? 'Saving…' : 'Save Changes'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  headerTitle: { ...type.h3, color: colors.textPrimary, flex: 1 },

  heroCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.xl, gap: 3,
  },
  heroLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  heroPrice: { ...type.h1, color: colors.textPrimary },
  heroMeta:  { ...type.bodySm, color: colors.textSecondary },
  heroCompare: { ...type.caption, color: colors.textTertiary, marginTop: 6 },

  trendBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 9, marginTop: spacing.md,
  },
  trendBannerText: { ...type.bodySm, fontWeight: '700', flex: 1 },

  statRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 3,
  },
  statLabel: { ...type.label, color: colors.textTertiary, textTransform: 'uppercase' },
  statValue: { ...type.bodyMed },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...type.h4, color: colors.textPrimary },
  cardHint:  { ...type.caption, color: colors.textTertiary },

  chartRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    height: CHART_HEIGHT, marginTop: spacing.xs,
  },
  chartBarSlot: { flex: 1, justifyContent: 'flex-end', minWidth: 4 },
  chartBar:     { width: '100%', borderRadius: 3 },
  chartAxis:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartAxisLabel: { ...type.caption, color: colors.textTertiary },

  storeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border,
  },
  storeRank: {
    width: 24, height: 24, borderRadius: radius.full,
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  storeRankText: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  storeName: { ...type.bodyMed, color: colors.textPrimary },
  storeMeta: { ...type.caption, color: colors.textTertiary },
  storeAvg:  { ...type.bodyMed, color: colors.textSecondary },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border,
  },
  entryPrice:     { ...type.bodyMed, color: colors.textPrimary },
  entryQty:       { ...type.caption, color: colors.textTertiary, fontWeight: '400' },
  entryMeta:      { ...type.caption, color: colors.textTertiary },
  entryUnitPrice: { ...type.caption, color: colors.textSecondary },
  entryActions:   { flexDirection: 'row', alignItems: 'center', gap: 12 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheetScroll: {
    backgroundColor: colors.surface, maxHeight: '90%',
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  sheetInner: {
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg, gap: 12,
  },
  dragHandle: {
    width: 36, height: 4, backgroundColor: colors.borderStrong,
    borderRadius: 2, alignSelf: 'center', marginBottom: 8,
  },
  sheetTitle:    { ...type.h3, color: colors.textPrimary },
  sheetSubtitle: { ...type.bodySm, color: colors.textSecondary, marginTop: -8 },
  inputLabel:    { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  formRow:     { flexDirection: 'row', gap: 12 },
  previewText: { ...type.caption, color: colors.textTertiary },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, marginRight: 6,
  },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipWrap: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipLabel:       { ...type.label, color: colors.textSecondary },
  chipLabelActive: { color: colors.accent },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelButton: {
    flex: 1, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.muted,
  },
  cancelButtonLabel: { ...type.bodyMed, color: colors.textSecondary },
  confirmButton: {
    flex: 2, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  confirmButtonDisabled: { opacity: 0.45 },
  confirmButtonLabel:    { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: radius.xl,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle:    { ...type.h4, color: colors.textPrimary },
  emptySubtitle: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
});
