import React, { useEffect, useRef, useState, useMemo, memo, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform, SafeAreaView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { differenceInDays, parseISO } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useHousehold } from '../../context/HouseholdContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import useFabHideOnScroll from '../../hooks/useFabHideOnScroll';
import FloatingActionButton from '../../components/FloatingActionButton';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { subscribePantryItems, addPantryItem, updatePantryItem, deletePantryItem, getHousehold } from '../../services/firestore';
import DatePickerInput from '../../components/DatePickerInput';
import DragScrollView from '../../components/DragScrollView';
import { spacing, radius, type } from '../../theme/colors';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS, withOverrides } from '../../utils/categories';

const applyOrder = (all, order) => {
  if (!order.length) return all;
  const map = new Map(order.map((label, i) => [label, i]));
  return [...all].sort((a, b) => (map.get(a.label) ?? 999) - (map.get(b.label) ?? 999));
};

const getExpiryStatus = (expiryDate, colors) => {
  if (!expiryDate) return null;
  const days = differenceInDays(parseISO(expiryDate), new Date());
  if (days < 0)  return { label: 'Expired',      bg: colors.dangerSoft,   text: colors.danger,  icon: 'warning',                  border: colors.danger  };
  if (days <= 3) return { label: `${days}d left`, bg: colors.dangerSoft,   text: colors.danger,  icon: 'time-outline',             border: colors.danger  };
  if (days <= 7) return { label: `${days}d left`, bg: colors.amberSoft,    text: colors.amber,   icon: 'time-outline',             border: colors.amber   };
  return              { label: `${days}d left`,   bg: colors.successSoft,  text: colors.success, icon: 'checkmark-circle-outline', border: colors.success };
};

const PantryItemRow = memo(({ item, onEdit, onDelete }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const expiry = getExpiryStatus(item.expiryDate, colors);
  return (
    <View style={[styles.pantryItemRow, expiry && { borderLeftColor: expiry.border }]}>
      <View style={styles.itemDetails}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemQuantityUnit}>{item.quantity} {item.unit}</Text>
        {expiry && (
          <View style={[styles.expiryTag, { backgroundColor: expiry.bg }]}>
            <Ionicons name={expiry.icon} size={10} color={expiry.text} />
            <Text style={[styles.expiryTagText, { color: expiry.text }]}>{expiry.label}</Text>
          </View>
        )}
      </View>
      <View style={styles.itemActions}>
        <TouchableOpacity
          onPress={onEdit}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
        >
          <Ionicons name="pencil-outline" size={17} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name}`}
        >
          <Ionicons name="trash-outline" size={17} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function PantryScreen() {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const { animationsEnabled } = useHousehold();
  const navScrollProps = useNavScrollProps();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();

  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [enabledCategoryLabels, setEnabledCategoryLabels]           = useState(null);
  const [customCategoryDefs, setCustomCategoryDefs]                 = useState([]);
  const [foodCategoryOrder, setFoodCategoryOrder]                   = useState([]);
  const [enabledNonFoodLabels, setEnabledNonFoodLabels]             = useState(null);
  const [customNonFoodCategoryDefs, setCustomNonFoodCategoryDefs]   = useState([]);
  const [nonFoodCategoryOrder, setNonFoodCategoryOrder]             = useState([]);
  const [foodOverrides, setFoodOverrides]                           = useState(null);
  const [nonFoodOverrides, setNonFoodOverrides]                     = useState(null);
  const [enabledUnits, setEnabledUnits]                             = useState(UNITS);
  const [customUnits, setCustomUnits]                               = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const [formName, setFormName]         = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formUnit, setFormUnit]         = useState('pcs');
  const [formCategory, setFormCategory] = useState('Other');
  const [formExpiry, setFormExpiry]     = useState('');
  const [errors, setErrors]             = useState({});

  useEffect(() => {
    if (!householdId) return;
    return subscribePantryItems(householdId, setItems);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      if (!householdId) return;
      getHousehold(householdId).then((hh) => {
        setEnabledCategoryLabels(hh?.pantryCategories ?? null);
        setCustomCategoryDefs(hh?.pantryCustomCategories ?? []);
        setFoodCategoryOrder(hh?.pantryCategoryOrder ?? []);
        setEnabledNonFoodLabels(hh?.nonFoodCategories ?? null);
        setCustomNonFoodCategoryDefs(hh?.nonFoodCustomCategories ?? []);
        setNonFoodCategoryOrder(hh?.nonFoodCategoryOrder ?? []);
        setFoodOverrides(hh?.pantryCategoryOverrides ?? null);
        setNonFoodOverrides(hh?.nonFoodCategoryOverrides ?? null);
        setEnabledUnits(hh?.enabledUnits ?? UNITS);
        setCustomUnits(hh?.customUnits ?? []);
      });
    }, [householdId]),
  );

  const visibleFoodCategories = useMemo(() => {
    const all = [...withOverrides(PANTRY_CATEGORIES, foodOverrides), ...customCategoryDefs];
    const enabled = enabledCategoryLabels ? all.filter((c) => enabledCategoryLabels.includes(c.label)) : all;
    return applyOrder(enabled, foodCategoryOrder);
  }, [enabledCategoryLabels, customCategoryDefs, foodCategoryOrder, foodOverrides]);

  const visibleNonFoodCategories = useMemo(() => {
    const all = [...withOverrides(NON_FOOD_CATEGORIES, nonFoodOverrides), ...customNonFoodCategoryDefs];
    const enabled = enabledNonFoodLabels ? all.filter((c) => enabledNonFoodLabels.includes(c.label)) : all;
    return applyOrder(enabled, nonFoodCategoryOrder);
  }, [enabledNonFoodLabels, customNonFoodCategoryDefs, nonFoodCategoryOrder, nonFoodOverrides]);

  const visibleCategories = useMemo(
    () => [...visibleFoodCategories, ...visibleNonFoodCategories],
    [visibleFoodCategories, visibleNonFoodCategories],
  );

  const resetForm = () => {
    setFormName('');
    setFormQuantity('');
    setFormUnit('pcs');
    setFormCategory('Other');
    setFormExpiry('');
    setErrors({});
  };

  const validate = () => {
    const e = {};
    if (!formName.trim()) e.name = 'Required';
    if (!formQuantity.trim()) e.quantity = 'Required';
    const isNonFood = visibleNonFoodCategories.some((c) => c.label === formCategory);
    if (!isNonFood && formExpiry.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(formExpiry.trim()))
      e.expiry = 'Use YYYY-MM-DD format';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const openAddModal = () => {
    setEditingItem(null);
    resetForm();
    const defaultCat = visibleCategories.find((c) => c.label === 'Other') ?? visibleCategories[0];
    setFormCategory(defaultCat?.label ?? 'Other');
    setModalVisible(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormQuantity(item.quantity);
    setFormUnit(item.unit);
    setFormCategory(item.category);
    setFormExpiry(item.expiryDate ?? '');
    setModalVisible(true);
  };

  const closeModal = () => {
    resetForm();
    setEditingItem(null);
    setModalVisible(false);
  };

  const handleSave = async () => {
    if (!validate()) return;
    const data = {
      name: formName.trim(),
      quantity: formQuantity.trim(),
      unit: formUnit,
      category: formCategory,
      expiryDate: formExpiry.trim() || null,
    };
    if (editingItem) {
      await updatePantryItem(householdId, editingItem.id, data);
      notify('Pantry updated', `${data.name} has been updated.`, { type: 'success' });
    } else {
      await addPantryItem(householdId, { ...data, addedBy: user.uid });
      notify('Added to pantry', `${data.name} added.`, { type: 'success' });
    }
    closeModal();
  };

  // ── Animations ────────────────────────────────────────────────────────────
  const headerAnim = useRef(new Animated.Value(0)).current;
  const fabAnim    = useRef(new Animated.Value(0)).current;
  const fab        = useFabHideOnScroll(fabAnim);

  // Replay the entrance on every focus (tab stays mounted, so a mount effect
  // would only fire once). Reset to 0 then animate in.
  useFocusEffect(
    useCallback(() => {
      if (!animationsEnabled) {
        headerAnim.setValue(1);
        fabAnim.setValue(1);
        return;
      }
      headerAnim.setValue(0);
      fabAnim.setValue(0);
      Animated.parallel([
        Animated.timing(headerAnim, {
          toValue: 1, duration: 380, useNativeDriver: true,
        }),
        Animated.spring(fabAnim, {
          toValue: 1, delay: 250, friction: 6, tension: 130, useNativeDriver: true,
        }),
      ]).start();
    }, [animationsEnabled]),
  );

  const filteredItems = items.filter((item) => {
    const matchesSearch   = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const groupedCategories = useMemo(() => {
    const makeGroups = (cats) =>
      cats
        .filter((cat) => selectedCategory === 'All' || cat.label === selectedCategory)
        .map((cat) => ({ type: 'group', ...cat, items: filteredItems.filter((i) => i.category === cat.label) }))
        .filter((g) => g.items.length > 0);

    const foodGroups    = makeGroups(visibleFoodCategories);
    const nonFoodGroups = makeGroups(visibleNonFoodCategories);
    const result = [];
    if (foodGroups.length > 0) {
      result.push({ type: 'section-header', id: 'food-header', title: 'Food' });
      result.push(...foodGroups);
    }
    if (nonFoodGroups.length > 0) {
      result.push({ type: 'section-header', id: 'non-food-header', title: 'Non-Food & Household' });
      result.push(...nonFoodGroups);
    }
    return result;
  }, [filteredItems, visibleFoodCategories, visibleNonFoodCategories, selectedCategory]);

  const expiringSoonCount = items.filter((item) => {
    const status = getExpiryStatus(item.expiryDate, colors);
    return status && status.text !== colors.success;
  }).length;

  return (
    <SafeAreaView style={styles.screenRoot}>
      <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>

        <Animated.View style={[styles.headerSection, {
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }]}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.screenTitle}>Pantry</Text>
              <Text style={styles.screenSubtitle}>{items.length} items stored</Text>
            </View>
            {expiringSoonCount > 0 && (
              <View style={styles.expiryWarningBadge}>
                <Ionicons name="warning-outline" size={13} color={colors.amber} />
                <Text style={styles.expiryWarningText}>{expiringSoonCount} expiring</Text>
              </View>
            )}
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={17} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search pantry…"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search pantry"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryFilterRow}
            contentContainerStyle={styles.categoryFilterRowContent}
          >
            {[{ label: 'All', icon: null }, ...visibleCategories].map((cat) => (
              <TouchableOpacity
                key={cat.label}
                style={[styles.categoryFilterPill, selectedCategory === cat.label && styles.categoryFilterPillActive]}
                onPress={() => setSelectedCategory(cat.label)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCategory === cat.label }}
              >
                {cat.icon && <Text style={styles.categoryFilterPillIcon}>{cat.icon}</Text>}
                <Text style={[styles.categoryFilterPillLabel, selectedCategory === cat.label && styles.categoryFilterPillLabelActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>

        <FlatList
          data={groupedCategories}
          keyExtractor={(row) => row.id ?? row.label}
          contentContainerStyle={styles.listContent}
          onScroll={(e) => { navScrollProps.onScroll(e); fab.onScroll(e); }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <View style={styles.emptyStateIcon}>
                <Ionicons name="nutrition-outline" size={36} color={colors.textTertiary} />
              </View>
              <Text style={styles.emptyStateTitle}>Pantry is empty</Text>
              <Text style={styles.emptyStateSubtitle}>Track what you have at home</Text>
            </View>
          }
          renderItem={({ item: row }) => {
            if (row.type === 'section-header') {
              return (
                <View style={styles.sectionDivider}>
                  <View style={styles.sectionDividerLine} />
                  <Text style={styles.sectionDividerText}>{row.title}</Text>
                  <View style={styles.sectionDividerLine} />
                </View>
              );
            }
            return (
              <View style={styles.categoryGroup}>
                <View style={styles.categoryGroupHeader}>
                  <Text style={styles.categoryGroupIcon}>{row.icon}</Text>
                  <Text style={styles.categoryGroupLabel}>{row.label}</Text>
                  <View style={styles.categoryGroupBadge}>
                    <Text style={styles.categoryGroupBadgeText}>{row.items.length}</Text>
                  </View>
                </View>
                {row.items.map((item) => (
                  <PantryItemRow
                    key={item.id}
                    item={item}
                    onEdit={() => openEditModal(item)}
                    onDelete={async () => {
                      const confirmed = await showConfirm({
                        title: 'Remove item',
                        message: `Remove "${item.name}"?`,
                        type: 'danger',
                        confirmLabel: 'Remove',
                      });
                      if (!confirmed) return;
                      try {
                        await deletePantryItem(householdId, item.id);
                        notify('Removed', `${item.name} removed from pantry.`, { type: 'info' });
                      } catch (e) {
                        showAlert({ title: 'Error', message: e.message, type: 'error' });
                      }
                    }}
                  />
                ))}
              </View>
            );
          }}
        />

        <FloatingActionButton
          onPress={openAddModal}
          accessibilityLabel="Add pantry item"
          enterAnim={fabAnim}
          hideAnim={fab.hideAnim}
          interactive={fab.interactive}
        />
      </View>

      <Modal visible={modalVisible} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeModal} />
          <ScrollView style={styles.bottomSheetScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.bottomSheetInner}>
              <View style={styles.sheetDragHandle} />
              <Text style={styles.sheetTitle}>{editingItem ? 'Edit Item' : 'Add to Pantry'}</Text>

              <Text style={styles.inputLabel}>Item Name *</Text>
              <TextInput
                style={[styles.textInput, !!errors.name && styles.inputError]}
                placeholder="e.g. Olive Oil"
                value={formName}
                onChangeText={(text) => { setFormName(text); if (errors.name) setErrors((e) => ({ ...e, name: null })); }}
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

              <View style={styles.quantityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Quantity *</Text>
                  <TextInput
                    style={[styles.textInput, !!errors.quantity && styles.inputError]}
                    placeholder="1"
                    value={formQuantity}
                    onChangeText={(text) => { setFormQuantity(text.replace(/[^0-9.]/g, '')); if (errors.quantity) setErrors((e) => ({ ...e, quantity: null })); }}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                  />
                  {!!errors.quantity && <Text style={styles.errorText}>{errors.quantity}</Text>}
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.inputLabel}>Unit</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {[...enabledUnits, ...customUnits].map((unit) => (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.unitChip, formUnit === unit && styles.unitChipActive]}
                        onPress={() => setFormUnit(unit)}
                      >
                        <Text style={[styles.unitChipLabel, formUnit === unit && styles.unitChipLabelActive]}>{unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <Text style={styles.inputLabel}>Category</Text>
              <DragScrollView style={{ marginBottom: 4 }}>
                {visibleFoodCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.label}
                    style={[styles.categoryChip, formCategory === cat.label && styles.categoryChipActive]}
                    onPress={() => setFormCategory(cat.label)}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryChipLabel, formCategory === cat.label && styles.categoryChipLabelActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                {visibleNonFoodCategories.length > 0 && (
                  <View style={styles.categoryChipDivider} />
                )}
                {visibleNonFoodCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.label}
                    style={[styles.categoryChip, formCategory === cat.label && styles.categoryChipActive]}
                    onPress={() => { setFormCategory(cat.label); setFormExpiry(''); }}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryChipLabel, formCategory === cat.label && styles.categoryChipLabelActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </DragScrollView>

              {!visibleNonFoodCategories.some((c) => c.label === formCategory) && (
                <>
                  <Text style={styles.inputLabel}>Expiry Date</Text>
                  <DatePickerInput
                    value={formExpiry}
                    onChange={(val) => { setFormExpiry(val); if (errors.expiry) setErrors((e) => ({ ...e, expiry: null })); }}
                    hasError={!!errors.expiry}
                  />
                  {!!errors.expiry && <Text style={styles.errorText}>{errors.expiry}</Text>}
                </>
              )}

              <View style={styles.sheetActionRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                  <Text style={styles.cancelButtonLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={handleSave}>
                  <Text style={styles.confirmButtonLabel}>{editingItem ? 'Save Changes' : 'Add Item'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screenRoot:            { flex: 1, backgroundColor: colors.background },
  contentWrapper:        { flex: 1 },
  contentWrapperDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  headerSection: {
    paddingTop: spacing.xl, paddingBottom: spacing.md,
  },
  headerTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: spacing.xl, marginBottom: spacing.md,
  },
  screenTitle:    { ...type.h2, color: colors.textPrimary },
  screenSubtitle: { ...type.bodySm, color: colors.textSecondary, marginTop: 3 },

  expiryWarningBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.amberSoft,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, marginTop: 4,
  },
  expiryWarningText: { ...type.label, color: colors.amber },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, height: 46,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...type.body, color: colors.textPrimary },

  categoryFilterRow: { marginBottom: spacing.md },
  categoryFilterRowContent: {
    flexDirection: 'row', gap: 7,
    paddingHorizontal: spacing.xl,
  },
  categoryFilterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  categoryFilterPillActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  categoryFilterPillIcon:        { fontSize: 12 },
  categoryFilterPillLabel:       { ...type.label, color: colors.textSecondary },
  categoryFilterPillLabelActive: { color: colors.accent },

  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 230 },

  emptyStateContainer: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyStateIcon: {
    width: 72, height: 72, borderRadius: radius.xl,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyStateTitle:    { ...type.h4, color: colors.textPrimary },
  emptyStateSubtitle: { ...type.body, color: colors.textSecondary },

  categoryGroup: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    marginBottom: spacing.md, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  categoryGroupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    borderLeftWidth: 3, borderLeftColor: colors.sage,
  },
  categoryGroupIcon:      { fontSize: 15 },
  categoryGroupLabel:     { ...type.label, color: colors.textSecondary, flex: 1, textTransform: 'uppercase' },
  categoryGroupBadge:     { backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  categoryGroupBadgeText: { ...type.caption, color: colors.textTertiary },

  sectionDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  sectionDividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  sectionDividerText: {
    ...type.label, color: colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 11,
  },
  categoryChipDivider: {
    width: 1, height: '80%', alignSelf: 'center',
    backgroundColor: colors.border, marginHorizontal: 6,
  },

  pantryItemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: colors.border, gap: 12,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  itemDetails:      { flex: 1, gap: 3 },
  itemActions:      { flexDirection: 'row', alignItems: 'center', gap: 16 },
  itemName:         { ...type.bodyMed, color: colors.textPrimary },
  itemQuantityUnit: { ...type.caption, color: colors.textTertiary },
  expiryTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm, marginTop: 3,
  },
  expiryTagText: { ...type.caption, fontWeight: '700' },


  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  bottomSheetScroll: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    maxHeight: '90%',
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  bottomSheetInner: {
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg, gap: 12,
  },
  sheetDragHandle: {
    width: 36, height: 4, backgroundColor: colors.borderStrong,
    borderRadius: 2, alignSelf: 'center', marginBottom: 8,
  },
  sheetTitle:  { ...type.h3, color: colors.textPrimary },
  inputLabel:  { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },

  quantityRow: { flexDirection: 'row', gap: 12 },
  unitChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, marginRight: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  unitChipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  unitChipLabel:       { ...type.label, color: colors.textSecondary },
  unitChipLabelActive: { color: colors.accent },

  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, marginRight: 8,
  },
  categoryChipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  categoryChipIcon:        { fontSize: 14 },
  categoryChipLabel:       { ...type.label, color: colors.textSecondary },
  categoryChipLabelActive: { color: colors.accent },

  sheetActionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelButton: {
    flex: 1, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.muted,
  },
  cancelButtonLabel:  { ...type.bodyMed, color: colors.textSecondary },
  confirmButton: {
    flex: 2, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  confirmButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },
});
