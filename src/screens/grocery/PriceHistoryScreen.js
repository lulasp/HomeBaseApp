import React, { useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import useFabHideOnScroll from '../../hooks/useFabHideOnScroll';
import FloatingActionButton from '../../components/FloatingActionButton';
import {
  subscribePriceEntries, addPriceEntry, getHousehold,
} from '../../services/firestore';
import {
  buildPriceHistory, recentStores, buildPriceEntry, itemKeyOf, buildStoreComparison,
  formatPrice, formatUnitPrice, formatPercent, trendPresentation,
} from '../../utils/pricing';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS, withOverrides } from '../../utils/categories';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

const SORTS = [
  { id: 'recent',  label: 'Recent'  },
  { id: 'up',      label: 'Rising'  },
  { id: 'down',    label: 'Falling' },
  { id: 'name',    label: 'A–Z'     },
];

const BLANK_ENTRY = { name: '', price: '', quantity: '1', unit: 'pcs', store: '', category: 'Other' };

// Suggestions shown at once. Capped so the panel stays a fixed, finger-friendly
// size and never needs a scroll view nested inside the sheet's own ScrollView
// (which breaks scrolling on react-native-web).
const PICKER_LIMIT = 6;

// ── Row ────────────────────────────────────────────────────────────────────────

const PriceRow = memo(({ item, icon, onPress }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const trend = trendPresentation(item.trend.direction);
  const trendColor = colors[trend.colorKey];
  const isFirst = item.trend.direction === 'new';

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.itemName}, last paid ${formatPrice(item.latest.price)}, ${trend.label}`}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{item.itemName}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatUnitPrice(item.latest.unitPrice, item.canonicalUnit)}
          {item.latest.store ? ` · ${item.latest.store}` : ''}
          {` · ${item.count} ${item.count === 1 ? 'entry' : 'entries'}`}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowPrice}>{formatPrice(item.latest.price)}</Text>
        <View style={[styles.trendBadge, { backgroundColor: `${trendColor}22` }]}>
          <Ionicons name={trend.icon} size={11} color={trendColor} />
          <Text style={[styles.trendBadgeLabel, { color: trendColor }]}>
            {isFirst ? 'New' : item.trend.direction === 'same' ? 'Flat' : formatPercent(item.trend.pct)}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function PriceHistoryScreen() {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const { notify } = useNotification();
  const navScrollProps = useNavScrollProps();
  const navigation = useNavigation();
  const isDesktop = useIsDesktop();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [sort, setSort]         = useState('recent');
  const [storeFilter, setStoreFilter] = useState(null);
  const [units, setUnits]       = useState(UNITS);
  const [categoryDefs, setCategoryDefs] = useState([]);

  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm]   = useState(BLANK_ENTRY);
  const [errors, setErrors] = useState({});
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    return subscribePriceEntries(householdId, (rows) => {
      setEntries(rows);
      setLoading(false);
    });
  }, [householdId]);

  // Household category/unit config, so the manual form offers the same choices
  // the grocery list does.
  useEffect(() => {
    if (!householdId) return;
    let active = true;
    getHousehold(householdId).then((hh) => {
      if (!active) return;
      setUnits([...(hh?.enabledUnits ?? UNITS), ...(hh?.customUnits ?? [])]);
      setCategoryDefs([
        ...withOverrides(PANTRY_CATEGORIES, hh?.pantryCategoryOverrides), ...(hh?.pantryCustomCategories ?? []),
        ...withOverrides(NON_FOOD_CATEGORIES, hh?.nonFoodCategoryOverrides), ...(hh?.nonFoodCustomCategories ?? []),
      ]);
    }).catch(() => { /* falls back to defaults */ });
    return () => { active = false; };
  }, [householdId]);

  const iconFor = useMemo(() => {
    const map = new Map(categoryDefs.map((c) => [c.label, c.icon]));
    return (label) => map.get(label) ?? '🛒';
  }, [categoryDefs]);

  const stores = useMemo(() => recentStores(entries, 20), [entries]);

  const visibleEntries = useMemo(
    () => (storeFilter ? entries.filter((e) => e.store === storeFilter) : entries),
    [entries, storeFilter],
  );

  const history = useMemo(() => buildPriceHistory(visibleEntries), [visibleEntries]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? history.filter((i) => i.itemName.toLowerCase().includes(term) || i.itemKey.includes(term))
      : history;
    const sorted = [...filtered];
    switch (sort) {
      case 'up':
        // Steepest rise first; items with no comparison sink to the bottom.
        sorted.sort((a, b) => trendValue(b) - trendValue(a));
        break;
      case 'down':
        sorted.sort((a, b) => trendValue(a) - trendValue(b));
        break;
      case 'name':
        sorted.sort((a, b) => a.itemName.localeCompare(b.itemName));
        break;
      default:
        break;   // buildPriceHistory already returns most-recent-first
    }
    return sorted;
  }, [history, search, sort]);

  // Where-to-shop ranking. Always over all entries, never the store filter —
  // filtering to one store would leave nothing to compare against.
  const comparison = useMemo(() => buildStoreComparison(entries), [entries]);

  const summary = useMemo(() => ({
    tracked:   history.length,
    cheaper:   history.filter((i) => i.trend.direction === 'down').length,
    pricier:   history.filter((i) => i.trend.direction === 'up').length,
  }), [history]);

  // ── Manual entry ────────────────────────────────────────

  // Every tracked item, ignoring the store filter — the picker offers the whole
  // catalogue even while the list below is narrowed to one store.
  const allItems = useMemo(() => buildPriceHistory(entries), [entries]);

  // Items offered in the dropdown: filtered by what's typed so far, capped so
  // the panel never needs its own scroll view nested inside the sheet.
  const pickerItems = useMemo(() => {
    const term = form.name.trim().toLowerCase();
    const matches = term
      ? allItems.filter((i) => i.itemName.toLowerCase().includes(term) || i.itemKey.includes(term))
      : allItems;
    return matches.slice(0, PICKER_LIMIT);
  }, [allItems, form.name]);

  // The typed name normalizes onto an existing item — logging will extend that
  // item's history rather than starting a new one, so say so.
  const matchedItem = useMemo(() => {
    const key = itemKeyOf(form.name);
    return key ? allItems.find((i) => i.itemKey === key) ?? null : null;
  }, [allItems, form.name]);

  const openForm = () => {
    setForm(BLANK_ENTRY); setErrors({}); setPickerOpen(false); setFormVisible(true);
  };
  const closeForm = () => { setFormVisible(false); setErrors({}); setPickerOpen(false); };

  // Picking an existing item carries over its category and the unit of its last
  // purchase — matching units is what keeps the per-unit comparison meaningful.
  const selectItem = (item) => {
    setForm((f) => ({
      ...f,
      name:     item.itemName,
      category: item.category || f.category,
      unit:     item.latest?.unit || f.unit,
    }));
    setErrors((e) => ({ ...e, name: null }));
    setPickerOpen(false);
  };

  const handleSave = async () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!form.price.trim() || !(Number(form.price) > 0)) errs.price = 'Enter a price';
    if (form.quantity.trim() && !(Number(form.quantity) > 0)) errs.quantity = 'Must be > 0';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const entry = buildPriceEntry({ ...form, addedBy: user.uid });
    if (!entry) { setErrors({ price: 'Enter a price' }); return; }
    try {
      await addPriceEntry(householdId, entry);
      notify('Price logged', `${entry.itemName} · ${formatPrice(entry.price)}`, { type: 'success' });
      closeForm();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  // ── Animations ──────────────────────────────────────────
  const fabAnim = useRef(new Animated.Value(1)).current;
  const fab = useFabHideOnScroll(fabAnim);

  return (
    <SafeAreaView style={styles.screenRoot}>
      <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>
        <View style={styles.headerSection}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.screenTitle}>Price History</Text>
              <Text style={styles.screenSubtitle}>
                {summary.tracked} tracked · {summary.cheaper} cheaper · {summary.pricier} pricier
              </Text>
            </View>
            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => navigation.navigate('ReceiptImport')}
              accessibilityRole="button"
              accessibilityLabel="Scan a receipt"
            >
              <Ionicons name="receipt-outline" size={15} color={colors.accent} />
              <Text style={styles.scanButtonLabel}>Scan</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search items"
              value={search}
              onChangeText={setSearch}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search tracked items"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.pillRow}>
            {SORTS.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.pill, sort === s.id && styles.pillActive]}
                onPress={() => setSort(s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === s.id }}
              >
                <Text style={[styles.pillLabel, sort === s.id && styles.pillLabelActive]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {stores.length > 0 && (
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[styles.pill, !storeFilter && styles.pillActive]}
                onPress={() => setStoreFilter(null)}
                accessibilityRole="button"
                accessibilityState={{ selected: !storeFilter }}
              >
                <Text style={[styles.pillLabel, !storeFilter && styles.pillLabelActive]}>All stores</Text>
              </TouchableOpacity>
              {stores.map((store) => (
                <TouchableOpacity
                  key={store}
                  style={[styles.pill, storeFilter === store && styles.pillActive]}
                  onPress={() => setStoreFilter(storeFilter === store ? null : store)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: storeFilter === store }}
                >
                  <Text style={[styles.pillLabel, storeFilter === store && styles.pillLabelActive]}>{store}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <FlatList
          data={items}
          keyExtractor={(item) => item.itemKey}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { navScrollProps.onScroll(e); fab.onScroll(e); }}
          scrollEventThrottle={16}
          ListHeaderComponent={
            comparison.comparable ? (
              <View style={styles.compareCard}>
                <View style={styles.compareHeader}>
                  <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.compareTitle}>Where to shop</Text>
                </View>

                <Text style={styles.compareHeadline}>
                  <Text style={{ color: colors.success }}>{comparison.best.store}</Text>
                  {comparison.best.saving > 0
                    ? ` is ${formatPrice(comparison.best.saving)} cheaper than ${comparison.best.versus}`
                    : ' matches the others on price'}
                </Text>

                {comparison.totals.map((row, i) => {
                  const max = comparison.totals[comparison.totals.length - 1].total || 1;
                  return (
                    <View key={row.store} style={styles.compareRow}>
                      <Text style={[styles.compareStore, i === 0 && { color: colors.success }]} numberOfLines={1}>
                        {row.store}
                      </Text>
                      <View style={styles.compareBarTrack}>
                        <View
                          style={[
                            styles.compareBarFill,
                            {
                              width: `${Math.max((row.total / max) * 100, 4)}%`,
                              backgroundColor: i === 0 ? colors.success : colors.borderStrong,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.compareTotal, i === 0 && { color: colors.success }]}>
                        {formatPrice(row.total)}
                      </Text>
                    </View>
                  );
                })}

                {/* The number only means something over the shared items, so say
                    exactly what it was computed from. */}
                <Text style={styles.compareNote}>
                  Same basket of {comparison.common.length} item
                  {comparison.common.length !== 1 ? 's' : ''} priced at all{' '}
                  {comparison.totals.length} stores, at your usual quantities.
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name={loading ? 'hourglass-outline' : 'pricetags-outline'}
                  size={34}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {loading ? 'Loading prices…'
                  : entries.length ? 'No matches'
                  : 'No prices logged yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {loading ? ''
                  : entries.length ? 'Try a different search or store filter.'
                  : 'Tick an item off your grocery list and enter what it cost, or tap + to log one.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <PriceRow
              item={item}
              icon={iconFor(item.category)}
              onPress={() => navigation.navigate('PriceDetail', { itemKey: item.itemKey })}
            />
          )}
        />

        <FloatingActionButton
          onPress={openForm}
          accessibilityLabel="Log a price"
          enterAnim={fabAnim}
          hideAnim={fab.hideAnim}
          interactive={fab.interactive}
        />
      </View>

      <Modal visible={formVisible} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeForm} />
          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetInner}>
              <View style={styles.dragHandle} />
              <Text style={styles.sheetTitle}>Log a Price</Text>

              <Text style={styles.inputLabel}>Item *</Text>
              {/* Combobox: type a new item, or open the list to pick a tracked one. */}
              <View style={[styles.comboRow, !!errors.name && styles.inputError]}>
                <TextInput
                  style={styles.comboInput}
                  placeholder="Search or type a new item"
                  value={form.name}
                  onChangeText={(name) => {
                    setForm((f) => ({ ...f, name }));
                    if (errors.name) setErrors((e) => ({ ...e, name: null }));
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                  accessibilityLabel="Item name"
                />
                {allItems.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setPickerOpen((open) => !open)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: pickerOpen }}
                    accessibilityLabel={pickerOpen ? 'Hide tracked items' : 'Show tracked items'}
                  >
                    <Ionicons
                      name={pickerOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                )}
              </View>
              {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

              {pickerOpen && pickerItems.length > 0 && (
                <View style={styles.pickerPanel}>
                  {pickerItems.map((pick, i) => (
                    <TouchableOpacity
                      key={pick.itemKey}
                      style={[styles.pickerRow, i > 0 && styles.pickerRowDivided]}
                      onPress={() => selectItem(pick)}
                      accessibilityRole="button"
                      accessibilityLabel={`${pick.itemName}, last paid ${formatPrice(pick.latest.price)}`}
                    >
                      <Text style={styles.pickerIcon}>{iconFor(pick.category)}</Text>
                      <Text style={styles.pickerName} numberOfLines={1}>{pick.itemName}</Text>
                      <Text style={styles.pickerMeta} numberOfLines={1}>
                        {formatPrice(pick.latest.price)} · {pick.count}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {allItems.length > pickerItems.length && (
                    <Text style={styles.pickerHint}>Keep typing to narrow the list…</Text>
                  )}
                </View>
              )}

              {/* Make the create-vs-extend outcome explicit before saving. */}
              {!!form.name.trim() && (
                <Text style={styles.comboNote}>
                  {matchedItem
                    ? `Adds to ${matchedItem.itemName}'s history · last ${formatPrice(matchedItem.latest.price)}`
                    : 'New item — starts its own price history'}
                </Text>
              )}

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

              <Text style={styles.inputLabel}>Unit</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {units.map((unit) => (
                  <TouchableOpacity
                    key={unit}
                    style={[styles.chip, form.unit === unit && styles.chipActive]}
                    onPress={() => setForm((f) => ({ ...f, unit }))}
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
              {stores.length > 0 && (
                <View style={styles.chipWrapRow}>
                  {stores.slice(0, 8).map((store) => (
                    <TouchableOpacity
                      key={store}
                      style={[styles.chipWrap, form.store === store && styles.chipActive]}
                      onPress={() => setForm((f) => ({ ...f, store }))}
                    >
                      <Text style={[styles.chipLabel, form.store === store && styles.chipLabelActive]}>{store}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.inputLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {categoryDefs.map((cat) => (
                  <TouchableOpacity
                    key={cat.label}
                    style={[styles.chip, form.category === cat.label && styles.chipActive]}
                    onPress={() => setForm((f) => ({ ...f, category: cat.label }))}
                  >
                    <Text style={styles.chipIcon}>{cat.icon}</Text>
                    <Text style={[styles.chipLabel, form.category === cat.label && styles.chipLabelActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeForm}>
                  <Text style={styles.cancelButtonLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={handleSave}>
                  <Text style={styles.confirmButtonLabel}>Save Price</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// Sort key for rising/falling: items with no prior comparison get 0 so they
// cluster in the middle rather than topping either list.
const trendValue = (item) =>
  (item.trend.direction === 'up' || item.trend.direction === 'down') ? item.trend.pct : 0;

const makeStyles = (colors) => StyleSheet.create({
  screenRoot:            { flex: 1, backgroundColor: colors.background },
  contentWrapper:        { flex: 1 },
  contentWrapperDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  headerSection: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
    paddingBottom: spacing.md, gap: spacing.md,
  },
  headerTopRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  screenTitle:    { ...type.h2, color: colors.textPrimary },
  screenSubtitle: { ...type.bodySm, color: colors.textSecondary, marginTop: 3 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, ...type.body, color: colors.textPrimary },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  pillActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pillLabel:       { ...type.label, color: colors.textSecondary },
  pillLabelActive: { color: colors.accent },

  scanButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
  },
  scanButtonLabel: { ...type.label, color: colors.accent },

  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 230 },

  compareCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: 8, marginBottom: spacing.md,
  },
  compareHeader:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compareTitle:    { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  compareHeadline: { ...type.bodyMed, color: colors.textPrimary },
  compareRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compareStore:    { ...type.bodySm, color: colors.textSecondary, width: 80 },
  compareBarTrack: {
    flex: 1, height: 8, borderRadius: 4,
    backgroundColor: colors.muted, overflow: 'hidden',
  },
  compareBarFill:  { height: '100%', borderRadius: 4 },
  compareTotal:    { ...type.bodySm, color: colors.textSecondary, width: 68, textAlign: 'right' },
  compareNote:     { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  rowIcon:  { fontSize: 18 },
  rowInfo:  { flex: 1, gap: 2 },
  rowName:  { ...type.bodyMed, color: colors.textPrimary },
  rowMeta:  { ...type.caption, color: colors.textTertiary },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowPrice: { ...type.bodyMed, color: colors.textPrimary },

  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
  },
  trendBadgeLabel: { ...type.caption, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 72, height: 72, borderRadius: radius.xl,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle:    { ...type.h4, color: colors.textPrimary },
  emptySubtitle: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

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
  sheetTitle: { ...type.h3, color: colors.textPrimary },
  inputLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  formRow: { flexDirection: 'row', gap: 12 },

  comboRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceElevated,
  },
  comboInput: { flex: 1, ...type.body, color: colors.textPrimary },
  comboNote:  { ...type.caption, color: colors.textTertiary },

  pickerPanel: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated, overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: spacing.lg, paddingVertical: 11,
  },
  pickerRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pickerIcon: { fontSize: 15 },
  pickerName: { ...type.bodyMed, color: colors.textPrimary, flex: 1 },
  pickerMeta: { ...type.caption, color: colors.textTertiary },
  pickerHint: {
    ...type.caption, color: colors.textTertiary,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
  },

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
  chipIcon:        { fontSize: 13 },
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
  confirmButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },
});
