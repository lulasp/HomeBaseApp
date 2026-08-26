import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform, SafeAreaView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useHousehold } from '../../context/HouseholdContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import useFabHideOnScroll from '../../hooks/useFabHideOnScroll';
import FloatingActionButton from '../../components/FloatingActionButton';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import {
  subscribeGroceryItems, addGroceryItem, toggleGroceryItem,
  deleteGroceryItem, clearCheckedItems, updateGroceryItem,
  addPantryItemFromGrocery, removePantryItemByGroceryId,
  getHousehold, subscribePriceEntries, addPriceEntry,
} from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS } from '../../utils/categories';
import {
  buildPriceEntry, lastEntryFor, recentStores, computeTrend, sortEntries,
  itemKeyOf, formatPrice, trendPresentation, formatPercent, summarizeBasket,
} from '../../utils/pricing';
import DatePickerInput from '../../components/DatePickerInput';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

const applyOrder = (all, order) => {
  if (!order.length) return all;
  const map = new Map(order.map((label, i) => [label, i]));
  return [...all].sort((a, b) => (map.get(a.label) ?? 999) - (map.get(b.label) ?? 999));
};

const GroceryItemRow = memo(({ item, priceInfo, onToggle, onEdit, onDelete, onOpenPrice }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const trendStyle = priceInfo ? trendPresentation(priceInfo.direction) : null;
  return (
    <View style={styles.groceryItemRow}>
      <TouchableOpacity
        style={styles.checkboxContainer}
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
        accessibilityLabel={`${item.name}, ${item.checked ? 'checked' : 'unchecked'}`}
      >
        <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
          {item.checked && <Ionicons name="checkmark" size={13} color="#fff" />}
        </View>
      </TouchableOpacity>
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, item.checked && styles.itemNameChecked]} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.itemMetaRow}>
          {item.quantity ? <Text style={styles.itemQuantity}>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</Text> : null}
          {priceInfo && (
            <TouchableOpacity
              style={styles.priceTag}
              onPress={onOpenPrice}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} last paid ${formatPrice(priceInfo.price)}. ${trendStyle.label}. View price history`}
            >
              <Text style={styles.priceTagValue}>{formatPrice(priceInfo.price)}</Text>
              {priceInfo.direction !== 'new' && priceInfo.direction !== 'same' && (
                <>
                  <Ionicons name={trendStyle.icon} size={11} color={colors[trendStyle.colorKey]} />
                  <Text style={[styles.priceTagDelta, { color: colors[trendStyle.colorKey] }]}>
                    {formatPercent(priceInfo.pct)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.itemActions}>
        <TouchableOpacity
          onPress={onEdit}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
        >
          <Ionicons name="pencil-outline" size={15} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name}`}
        >
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function GroceryListScreen() {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const { animationsEnabled } = useHousehold();
  const navScrollProps = useNavScrollProps();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const navigation = useNavigation();

  const [items, setItems] = useState([]);
  const [priceEntries, setPriceEntries] = useState([]);
  const [enabledCategoryLabels, setEnabledCategoryLabels]           = useState(null);
  const [customCategoryDefs, setCustomCategoryDefs]                 = useState([]);
  const [foodCategoryOrder, setFoodCategoryOrder]                   = useState([]);
  const [enabledNonFoodLabels, setEnabledNonFoodLabels]             = useState(null);
  const [customNonFoodCategoryDefs, setCustomNonFoodCategoryDefs]   = useState([]);
  const [nonFoodCategoryOrder, setNonFoodCategoryOrder]             = useState([]);
  const [enabledUnits, setEnabledUnits]                             = useState(UNITS);
  const [customUnits, setCustomUnits]                               = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('pcs');
  const [newItemExpiry, setNewItemExpiry] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Other');
  const [activeFilter, setActiveFilter] = useState('all');
  const [errors, setErrors] = useState({});
  // Check-off sheet: captures the pantry expiry date and (optionally) what the
  // item cost, so price history builds up from the normal shopping flow.
  const [checkoutItem, setCheckoutItem]   = useState(null);
  const [checkoutExpiry, setCheckoutExpiry] = useState('');
  const [checkoutPrice, setCheckoutPrice]   = useState('');
  const [checkoutStore, setCheckoutStore]   = useState('');

  useEffect(() => {
    if (!householdId) return;
    return subscribeGroceryItems(householdId, setItems);
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    return subscribePriceEntries(householdId, setPriceEntries);
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
        setEnabledUnits(hh?.enabledUnits ?? UNITS);
        setCustomUnits(hh?.customUnits ?? []);
      });
    }, [householdId]),
  );

  const visibleFoodCategories = useMemo(() => {
    const all = [...PANTRY_CATEGORIES, ...customCategoryDefs];
    const enabled = enabledCategoryLabels ? all.filter((c) => enabledCategoryLabels.includes(c.label)) : all;
    return applyOrder(enabled, foodCategoryOrder);
  }, [enabledCategoryLabels, customCategoryDefs, foodCategoryOrder]);

  const visibleNonFoodCategories = useMemo(() => {
    const all = [...NON_FOOD_CATEGORIES, ...customNonFoodCategoryDefs];
    const enabled = enabledNonFoodLabels ? all.filter((c) => enabledNonFoodLabels.includes(c.label)) : all;
    return applyOrder(enabled, nonFoodCategoryOrder);
  }, [enabledNonFoodLabels, customNonFoodCategoryDefs, nonFoodCategoryOrder]);

  const visibleCategories = useMemo(
    () => [...visibleFoodCategories, ...visibleNonFoodCategories],
    [visibleFoodCategories, visibleNonFoodCategories],
  );

  // Keep a ref to items so the midnight timer can read the latest list
  // without being rescheduled every time items change.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Auto-clear checked items at midnight every day the app is open.
  useEffect(() => {
    if (!householdId) return;
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const ms = nextMidnight.getTime() - now.getTime();
    const timer = setTimeout(async () => {
      const current = itemsRef.current;
      const checkedCount = current.filter((i) => i.checked).length;
      if (!checkedCount) return;
      try {
        await clearCheckedItems(householdId, current);
        notify('Grocery list cleared', `${checkedCount} done item${checkedCount !== 1 ? 's' : ''} cleared at midnight.`, { type: 'info' });
      } catch { /* silent */ }
    }, ms);
    return () => clearTimeout(timer);
  }, [householdId]);

  const groupedItems = useCallback(() => {
    const filtered = activeFilter === 'all' ? items
      : items.filter((i) => activeFilter === 'checked' ? i.checked : !i.checked);

    const makeGroups = (cats) =>
      cats
        .map((cat) => ({ type: 'group', ...cat, items: filtered.filter((i) => i.category === cat.label) }))
        .filter((g) => g.items.length > 0);

    const foodGroups    = makeGroups(visibleFoodCategories);
    const nonFoodGroups = makeGroups(visibleNonFoodCategories);

    // Items with an unrecognised category fall into the Food "Other" group
    const knownLabels = new Set(visibleCategories.map((c) => c.label));
    const orphans = filtered.filter((i) => !knownLabels.has(i.category));
    if (orphans.length > 0) {
      const otherGroup = foodGroups.find((g) => g.label === 'Other');
      if (otherGroup) {
        otherGroup.items = [...otherGroup.items, ...orphans];
      } else {
        foodGroups.push({ type: 'group', label: 'Other', icon: '📦', items: orphans });
      }
    }

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
  }, [items, activeFilter, visibleFoodCategories, visibleNonFoodCategories, visibleCategories]);

  // Last recorded price per item key, with the trend against the previous one.
  // Keyed so a row lookup is O(1) rather than a scan per render.
  const priceByItemKey = useMemo(() => {
    const groups = new Map();
    for (const entry of priceEntries) {
      const key = entry.itemKey || itemKeyOf(entry.itemName);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const map = new Map();
    for (const [key, group] of groups) {
      const trend = computeTrend(sortEntries(group));
      if (!trend.latest) continue;
      map.set(key, { price: trend.latest.price, direction: trend.direction, pct: trend.pct });
    }
    return map;
  }, [priceEntries]);

  const storeSuggestions = useMemo(() => recentStores(priceEntries), [priceEntries]);

  const checkoutLastEntry = useMemo(
    () => (checkoutItem ? lastEntryFor(priceEntries, checkoutItem.name) : null),
    [checkoutItem, priceEntries],
  );

  const basket = useMemo(() => summarizeBasket(items, priceEntries), [items, priceEntries]);

  // Toggles a grocery item and syncs the change to the pantry:
  // checking → adds a linked pantry item; unchecking → removes it.
  const handleToggle = useCallback(async (item) => {
    const newChecked = !item.checked;
    try {
      await toggleGroceryItem(householdId, item.id, newChecked);
      if (newChecked) {
        const previous = lastEntryFor(priceEntries, item.name);
        setCheckoutItem(item);
        setCheckoutExpiry('');
        setCheckoutPrice('');
        // Pre-fill the store from the last purchase — most shops repeat.
        setCheckoutStore(previous?.store || '');
      } else {
        await removePantryItemByGroceryId(householdId, item.id);
      }
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  }, [householdId, showAlert, priceEntries]);

  // Closes the check-off sheet, writing the pantry item and — when a price was
  // entered — a price-history entry. `save` false means "skip", which still
  // files the pantry item (the item is already checked off at this point).
  const handleCheckoutConfirm = async (save) => {
    if (!checkoutItem) return;
    const item   = { ...checkoutItem, expiryDate: (save && checkoutExpiry) || null };
    const price  = save ? checkoutPrice.trim() : '';
    const store  = save ? checkoutStore.trim() : '';
    setCheckoutItem(null);
    setCheckoutExpiry('');
    setCheckoutPrice('');
    setCheckoutStore('');
    try {
      await addPantryItemFromGrocery(householdId, item);
      const entry = price
        ? buildPriceEntry({
            name:     item.name,
            price,
            quantity: item.quantity,
            unit:     item.unit,
            category: item.category,
            store,
            addedBy:  user.uid,
          })
        : null;
      if (entry) {
        const previous = lastEntryFor(priceEntries, item.name);
        // Tie the entry to the list item so the trip's running total is exact
        // rather than inferred from dates.
        await addPriceEntry(householdId, { ...entry, groceryItemId: item.id });
        notify(
          'Added to pantry',
          previous
            ? `${item.name} · ${formatPrice(entry.price)} (last ${formatPrice(previous.price)})`
            : `${item.name} · ${formatPrice(entry.price)} — first price logged.`,
          { type: 'success' },
        );
      } else {
        notify('Added to pantry', `${item.name} added to your pantry.`, { type: 'success' });
      }
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const closeModal = () => {
    setNewItemName('');
    setNewItemQuantity('');
    setNewItemUnit('pcs');
    setNewItemExpiry('');
    setSelectedCategory('Other');
    setErrors({});
    setEditingItem(null);
    setModalVisible(false);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setNewItemName(item.name);
    setNewItemQuantity(item.quantity || '');
    setNewItemUnit(item.unit || 'pcs');
    setNewItemExpiry(item.expiryDate || '');
    setSelectedCategory(item.category || 'Other');
    setErrors({});
    setModalVisible(true);
  };

  const validate = () => {
    const e = {};
    if (!newItemName.trim()) e.name = 'Required';
    if (!newItemQuantity.trim()) e.quantity = 'Required';
    const isNonFood = visibleNonFoodCategories.some((c) => c.label === selectedCategory);
    if (!isNonFood && newItemExpiry.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(newItemExpiry.trim()))
      e.expiry = 'Use YYYY-MM-DD format';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAddItem = async () => {
    if (!validate()) return;
    await addGroceryItem(householdId, {
      name: newItemName.trim(),
      quantity: newItemQuantity.trim(),
      unit: newItemUnit,
      category: selectedCategory,
      expiryDate: newItemExpiry.trim() || null,
      addedBy: user.uid,
    });
    notify('Added to list', `${newItemName.trim()} added.`, { type: 'success' });
    closeModal();
  };

  const handleSaveEdit = async () => {
    if (!validate()) return;
    try {
      await updateGroceryItem(householdId, editingItem.id, {
        name: newItemName.trim(),
        quantity: newItemQuantity.trim(),
        unit: newItemUnit,
        category: selectedCategory,
        expiryDate: newItemExpiry.trim() || null,
      });
      notify('Item updated', `${newItemName.trim()} saved.`, { type: 'success' });
      closeModal();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const handleClearChecked = async () => {
    const checkedCount = items.filter((i) => i.checked).length;
    if (!checkedCount) return;
    const confirmed = await showConfirm({
      title: 'Clear checked',
      message: `Remove ${checkedCount} item${checkedCount > 1 ? 's' : ''}?`,
      type: 'danger',
      confirmLabel: 'Clear',
    });
    if (!confirmed) return;
    try {
      await clearCheckedItems(householdId, items);
      notify('List cleared', `${checkedCount} item${checkedCount > 1 ? 's' : ''} removed.`, { type: 'info' });
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const pendingCount  = items.filter((i) => !i.checked).length;
  const checkedCount  = items.filter((i) => i.checked).length;
  const totalCount    = items.length;
  const progressRatio = totalCount > 0 ? checkedCount / totalCount : 0;
  const groups        = groupedItems();

  // ── Animations ────────────────────────────────────────────────────────────
  const headerAnim   = useRef(new Animated.Value(0)).current;
  const fabAnim      = useRef(new Animated.Value(0)).current;
  const fab          = useFabHideOnScroll(fabAnim);
  const progressAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (!animationsEnabled) {
      progressAnim.setValue(progressRatio);
      return;
    }
    Animated.spring(progressAnim, {
      toValue: progressRatio,
      friction: 9,
      tension: 45,
      useNativeDriver: false,
    }).start();
  }, [progressRatio, animationsEnabled]);

  return (
    <SafeAreaView style={styles.screenRoot}>
      <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>

        <Animated.View style={[styles.headerSection, {
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }]}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.screenTitle}>Grocery List</Text>
              <Text style={styles.screenSubtitle}>
                {pendingCount} remaining · {checkedCount} done
              </Text>
            </View>
            <View style={styles.headerActions}>
              {checkedCount > 0 && (
                <TouchableOpacity
                  style={styles.clearCheckedButton}
                  onPress={handleClearChecked}
                  accessibilityRole="button"
                  accessibilityLabel="Clear checked items"
                >
                  <Ionicons name="checkmark-done-outline" size={14} color={colors.accent} />
                  <Text style={styles.clearCheckedLabel}>Clear done</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.priceHistoryButton}
                onPress={() => navigation.navigate('PriceHistory')}
                accessibilityRole="button"
                accessibilityLabel="Price history"
              >
                <Ionicons name="pricetags-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.priceHistoryLabel}>Prices</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Trip cost: what's been rung up so far, and what the till is likely
              to say once the rest of the list is picked up. */}
          {basket.pricedCount > 0 && (
            <View style={styles.basketCard}>
              <View style={styles.basketMain}>
                <View>
                  <Text style={styles.basketLabel}>
                    {basket.loggedCount > 0 ? 'Projected total' : 'Estimated total'}
                  </Text>
                  <Text style={styles.basketTotal}>{formatPrice(basket.projected)}</Text>
                </View>
                {basket.loggedCount > 0 && (
                  <View style={styles.basketSplit}>
                    <Text style={styles.basketSplitValue}>{formatPrice(basket.actual)}</Text>
                    <Text style={styles.basketSplitLabel}>in basket</Text>
                  </View>
                )}
                {basket.remaining > 0 && (
                  <View style={styles.basketSplit}>
                    <Text style={styles.basketSplitValue}>{formatPrice(basket.remaining)}</Text>
                    <Text style={styles.basketSplitLabel}>to go</Text>
                  </View>
                )}
              </View>
              {basket.unpricedCount > 0 && (
                <Text style={styles.basketNote}>
                  {basket.unpricedCount} item{basket.unpricedCount !== 1 ? 's' : ''} with no price history yet
                </Text>
              )}
            </View>
          )}

          {totalCount > 0 && (
            <View style={styles.progressBarTrack}>
              <Animated.View style={[styles.progressBarFill, {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                  extrapolate: 'clamp',
                }),
              }]} />
            </View>
          )}

          <View style={styles.filterRow}>
            {[
              { id: 'all',       label: 'All'       },
              { id: 'unchecked', label: 'Pending'   },
              { id: 'checked',   label: 'Done'      },
            ].map((filter) => (
              <TouchableOpacity
                key={filter.id}
                style={[styles.filterPill, activeFilter === filter.id && styles.filterPillActive]}
                onPress={() => setActiveFilter(filter.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: activeFilter === filter.id }}
              >
                <Text style={[styles.filterPillLabel, activeFilter === filter.id && styles.filterPillLabelActive]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        <FlatList
          data={groups}
          keyExtractor={(row) => row.id ?? row.label}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { navScrollProps.onScroll(e); fab.onScroll(e); }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <View style={styles.emptyStateIcon}>
                <Ionicons name="cart-outline" size={36} color={colors.textTertiary} />
              </View>
              <Text style={styles.emptyStateTitle}>List is empty</Text>
              <Text style={styles.emptyStateSubtitle}>Tap + to add your first item</Text>
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
                  <GroceryItemRow
                    key={item.id}
                    item={item}
                    priceInfo={priceByItemKey.get(itemKeyOf(item.name))}
                    onOpenPrice={() => navigation.navigate('PriceDetail', { itemKey: itemKeyOf(item.name) })}
                    onToggle={() => handleToggle(item)}
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
                        if (item.checked) await removePantryItemByGroceryId(householdId, item.id);
                        await deleteGroceryItem(householdId, item.id);
                        notify('Removed', `${item.name} removed from list.`, { type: 'info' });
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
          onPress={() => setModalVisible(true)}
          accessibilityLabel="Add item"
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
              <Text style={styles.sheetTitle}>{editingItem ? 'Edit Item' : 'Add to List'}</Text>

              <Text style={styles.inputLabel}>Item Name *</Text>
              <TextInput
                style={[styles.textInput, !!errors.name && styles.inputError]}
                placeholder="e.g. Olive Oil"
                value={newItemName}
                onChangeText={(text) => { setNewItemName(text); if (errors.name) setErrors((e) => ({ ...e, name: null })); }}
                placeholderTextColor={colors.textTertiary}
                autoFocus
                accessibilityLabel="Item name"
              />
              {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

              <View style={styles.quantityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Quantity *</Text>
                  <TextInput
                    style={[styles.textInput, !!errors.quantity && styles.inputError]}
                    placeholder="1"
                    value={newItemQuantity}
                    onChangeText={(text) => { setNewItemQuantity(text.replace(/[^0-9.]/g, '')); if (errors.quantity) setErrors((e) => ({ ...e, quantity: null })); }}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Quantity"
                  />
                  {!!errors.quantity && <Text style={styles.errorText}>{errors.quantity}</Text>}
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.inputLabel}>Unit</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {[...enabledUnits, ...customUnits].map((unit) => (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.unitChip, newItemUnit === unit && styles.unitChipActive]}
                        onPress={() => setNewItemUnit(unit)}
                      >
                        <Text style={[styles.unitChipLabel, newItemUnit === unit && styles.unitChipLabelActive]}>{unit}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <Text style={styles.inputLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                {visibleFoodCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.label}
                    style={[styles.categoryChip, selectedCategory === cat.label && styles.categoryChipActive]}
                    onPress={() => setSelectedCategory(cat.label)}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryChipLabel, selectedCategory === cat.label && styles.categoryChipLabelActive]}>
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
                    style={[styles.categoryChip, selectedCategory === cat.label && styles.categoryChipActive]}
                    onPress={() => { setSelectedCategory(cat.label); setNewItemExpiry(''); }}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryChipLabel, selectedCategory === cat.label && styles.categoryChipLabelActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {!visibleNonFoodCategories.some((c) => c.label === selectedCategory) && (
                <>
                  <Text style={styles.inputLabel}>Expiry Date</Text>
                  <DatePickerInput
                    value={newItemExpiry}
                    onChange={(val) => { setNewItemExpiry(val); if (errors.expiry) setErrors((e) => ({ ...e, expiry: null })); }}
                    hasError={!!errors.expiry}
                  />
                  {!!errors.expiry && <Text style={styles.errorText}>{errors.expiry}</Text>}
                </>
              )}

              <View style={styles.sheetActionRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                  <Text style={styles.cancelButtonLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={editingItem ? handleSaveEdit : handleAddItem}>
                  <Text style={styles.confirmButtonLabel}>{editingItem ? 'Save Changes' : 'Add to List'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!checkoutItem} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => handleCheckoutConfirm(false)} />
          <ScrollView style={styles.bottomSheetScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.bottomSheetInner}>
              <View style={styles.sheetDragHandle} />
              <View style={styles.expirySheetHeader}>
                <View style={[styles.expirySheetIcon, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expirySheetTitle} numberOfLines={1}>{checkoutItem?.name}</Text>
                  <Text style={styles.expirySheetSub}>
                    Added to pantry — log what it cost?
                  </Text>
                </View>
              </View>

              <View style={styles.quantityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Price Paid</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="0.00"
                    value={checkoutPrice}
                    onChangeText={(text) => setCheckoutPrice(text.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Price paid"
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.inputLabel}>Store</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Lidl"
                    value={checkoutStore}
                    onChangeText={setCheckoutStore}
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Store"
                  />
                </View>
              </View>

              {/* Total for the whole quantity — restated so it's unambiguous
                  what the number covers when comparing per-unit later. */}
              {!!checkoutItem?.quantity && (
                <Text style={styles.checkoutHint}>
                  Total for {checkoutItem.quantity}{checkoutItem.unit ? ` ${checkoutItem.unit}` : ''}
                  {checkoutLastEntry
                    ? ` · last paid ${formatPrice(checkoutLastEntry.price)}${checkoutLastEntry.store ? ` at ${checkoutLastEntry.store}` : ''}`
                    : ''}
                </Text>
              )}

              {storeSuggestions.length > 0 && (
                <View style={styles.storeChipRow}>
                  {storeSuggestions.map((store) => (
                    <TouchableOpacity
                      key={store}
                      style={[styles.storeChip, checkoutStore === store && styles.storeChipActive]}
                      onPress={() => setCheckoutStore(store)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: checkoutStore === store }}
                    >
                      <Text style={[styles.storeChipLabel, checkoutStore === store && styles.storeChipLabelActive]}>
                        {store}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {!visibleNonFoodCategories.some((c) => c.label === checkoutItem?.category) && (
                <>
                  <Text style={styles.inputLabel}>Expiry Date</Text>
                  <DatePickerInput value={checkoutExpiry} onChange={setCheckoutExpiry} />
                </>
              )}

              <View style={styles.sheetActionRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => handleCheckoutConfirm(false)}>
                  <Text style={styles.cancelButtonLabel}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, !checkoutPrice && !checkoutExpiry && styles.confirmButtonDisabled]}
                  disabled={!checkoutPrice && !checkoutExpiry}
                  onPress={() => handleCheckoutConfirm(true)}
                >
                  <Text style={styles.confirmButtonLabel}>Save</Text>
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
  screenRoot:             { flex: 1, backgroundColor: colors.background },
  contentWrapper:         { flex: 1 },
  contentWrapperDesktop:  { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  headerSection: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  headerTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  screenTitle:    { ...type.h2, color: colors.textPrimary },
  screenSubtitle: { ...type.bodySm, color: colors.textSecondary, marginTop: 3 },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clearCheckedButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
  },
  clearCheckedLabel: { ...type.label, color: colors.accent },

  priceHistoryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
  },
  priceHistoryLabel: { ...type.label, color: colors.textSecondary },

  basketCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    gap: 6,
  },
  basketMain:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xl },
  basketLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  basketTotal: { ...type.h3, color: colors.textPrimary, marginTop: 2 },
  basketSplit: { alignItems: 'flex-start' },
  basketSplitValue: { ...type.bodyMed, color: colors.textSecondary },
  basketSplitLabel: { ...type.caption, color: colors.textTertiary },
  basketNote:  { ...type.caption, color: colors.textTertiary },

  progressBarTrack: {
    height: 5, backgroundColor: colors.muted,
    borderRadius: 3, overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%', backgroundColor: colors.accent,
    borderRadius: 3,
    shadowColor: colors.accent,
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  filterRow: { flexDirection: 'row', gap: 6 },
  filterPill: {
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  filterPillActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  filterPillLabel:       { ...type.label, color: colors.textSecondary },
  filterPillLabelActive: { color: colors.accent },

  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 230 },

  emptyStateContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
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
  },
  categoryGroupIcon:        { fontSize: 14 },
  categoryGroupLabel:       { ...type.label, color: colors.textSecondary, flex: 1, textTransform: 'uppercase' },
  categoryGroupBadge:       { backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  categoryGroupBadgeText:   { ...type.caption, color: colors.textTertiary },

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

  groceryItemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: colors.border, gap: 12,
  },
  checkboxContainer: { padding: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked:  { backgroundColor: colors.accent, borderColor: colors.accent },
  itemInfo:         { flex: 1, gap: 2 },
  itemActions:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemName:         { ...type.bodyMed, color: colors.textPrimary },
  itemNameChecked:  { textDecorationLine: 'line-through', color: colors.textTertiary },
  itemQuantity:     { ...type.caption, color: colors.textTertiary },
  itemMetaRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  priceTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.muted,
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: radius.full,
  },
  priceTagValue: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  priceTagDelta: { ...type.caption, fontWeight: '700' },

  checkoutHint: { ...type.caption, color: colors.textTertiary },
  storeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  storeChip: {
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  storeChipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  storeChipLabel:       { ...type.label, color: colors.textSecondary },
  storeChipLabelActive: { color: colors.accent },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  expirySheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg,
    gap: 14,
  },
  expirySheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  expirySheetIcon: {
    width: 42, height: 42, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  expirySheetTitle: { ...type.bodyMed, color: colors.textPrimary },
  expirySheetSub:   { ...type.caption, color: colors.textSecondary, marginTop: 2 },
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
  sheetTitle: { ...type.h3, color: colors.textPrimary },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  inputLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },

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
    borderWidth: 1, borderColor: colors.border,
    marginRight: 6,
  },
  categoryChipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  categoryChipIcon:        { fontSize: 13 },
  categoryChipLabel:       { ...type.label, color: colors.textSecondary },
  categoryChipLabelActive: { color: colors.accent },

  sheetActionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelButton: {
    flex: 1, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.muted,
  },
  cancelButtonLabel:       { ...type.bodyMed, color: colors.textSecondary },
  confirmButton: {
    flex: 2, height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  confirmButtonDisabled: { opacity: 0.45 },
  confirmButtonLabel:    { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },
});
