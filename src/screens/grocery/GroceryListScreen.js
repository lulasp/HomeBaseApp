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
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
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
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS, withOverrides, categoryName, unitName } from '../../utils/categories';
import {
  buildPriceEntry, lastEntryFor, recentStores, computeTrend, sortEntries,
  itemKeyOf, formatPrice, trendPresentation, formatPercent, summarizeBasket,
} from '../../utils/pricing';
import DatePickerInput from '../../components/DatePickerInput';
import DragScrollView from '../../components/DragScrollView';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useIsDesktop, useMobileNavClearance, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { t } from '../../i18n';
import { useLanguage } from '../../context/LanguageContext';

const applyOrder = (all, order) => {
  if (!order.length) return all;
  const map = new Map(order.map((label, i) => [label, i]));
  return [...all].sort((a, b) => (map.get(a.label) ?? 999) - (map.get(b.label) ?? 999));
};

const GroceryItemRow = memo(({ item, priceInfo, onToggle, onEdit, onDelete, onOpenPrice }) => {
  const { colors } = useTheme();
  useLanguage();   // memo: re-render on a language switch
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
        accessibilityLabel={`${item.name}, ${item.checked ? t('grocery.checked') : t('grocery.unchecked')}`}
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
          {item.quantity ? <Text style={styles.itemQuantity}>{item.quantity}{item.unit ? ` ${unitName(item.unit)}` : ''}</Text> : null}
          {priceInfo && (
            <TouchableOpacity
              style={styles.priceTag}
              onPress={onOpenPrice}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('grocery.lastPaidA11y', { name: item.name, price: formatPrice(priceInfo.price), trend: trendStyle.label })}
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
          accessibilityLabel={t('grocery.editItem', { name: item.name })}
        >
          <Ionicons name="pencil-outline" size={15} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('grocery.removeItemA11y', { name: item.name })}
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
  useLanguage();
  const { animationsEnabled } = useHousehold();
  const navScrollProps = useNavScrollProps();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const navClearance = useMobileNavClearance();
  const viewportHeight = useVisualViewportHeight();
  const navigation = useNavigation();

  // Measured so the list can be given a definite pixel height on web (see the
  // ScrollView height note at the render below).
  const [headerHeight, setHeaderHeight] = useState(0);

  const [items, setItems] = useState([]);
  const [priceEntries, setPriceEntries] = useState([]);
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
        notify(t('grocery.listCleared'), t('grocery.clearedAtMidnight', { count: checkedCount }), { type: 'info' });
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
      result.push({ type: 'section-header', id: 'food-header', title: t('grocery.food') });
      result.push(...foodGroups);
    }
    if (nonFoodGroups.length > 0) {
      result.push({ type: 'section-header', id: 'non-food-header', title: t('grocery.nonFood') });
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
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
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
          t('grocery.addedToPantry'),
          previous
            ? t('grocery.priceWithLast', { name: item.name, price: formatPrice(entry.price), last: formatPrice(previous.price) })
            : t('grocery.firstPrice', { name: item.name, price: formatPrice(entry.price) }),
          { type: 'success' },
        );
      } else {
        notify(t('grocery.addedToPantry'), t('grocery.addedToPantryMessage', { name: item.name }), { type: 'success' });
      }
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
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
    if (!newItemName.trim()) e.name = t('common.required');
    if (!newItemQuantity.trim()) e.quantity = t('common.required');
    const isNonFood = visibleNonFoodCategories.some((c) => c.label === selectedCategory);
    if (!isNonFood && newItemExpiry.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(newItemExpiry.trim()))
      e.expiry = t('grocery.useDateFormat');
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
    notify(t('grocery.addedToList'), t('grocery.addedMessage', { name: newItemName.trim() }), { type: 'success' });
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
      notify(t('grocery.itemUpdated'), t('grocery.savedMessage', { name: newItemName.trim() }), { type: 'success' });
      closeModal();
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
    }
  };

  const handleClearChecked = async () => {
    const checkedCount = items.filter((i) => i.checked).length;
    if (!checkedCount) return;
    const confirmed = await showConfirm({
      title: t('grocery.clearChecked'),
      message: t('grocery.removeCount', { count: checkedCount }),
      type: 'danger',
      confirmLabel: t('grocery.clear'),
    });
    if (!confirmed) return;
    try {
      await clearCheckedItems(householdId, items);
      notify(t('grocery.listClearedShort'), t('grocery.itemsRemoved', { count: checkedCount }), { type: 'info' });
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
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
    <SafeAreaView style={[
      styles.screenRoot,
      Platform.OS === 'web' ? { height: viewportHeight } : null,
    ]}>
      <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>

        <Animated.View
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
          style={[styles.headerSection, {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
          }]}
        >
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={styles.screenTitle}>{t('grocery.title')}</Text>
              <Text style={styles.screenSubtitle}>
                {t('grocery.remainingDone', { pending: pendingCount, done: checkedCount })}
              </Text>
            </View>
            <View style={styles.headerActions}>
              {checkedCount > 0 && (
                <TouchableOpacity
                  style={styles.clearCheckedButton}
                  onPress={handleClearChecked}
                  accessibilityRole="button"
                  accessibilityLabel={t('grocery.clearCheckedA11y')}
                >
                  <Ionicons name="checkmark-done-outline" size={14} color={colors.accent} />
                  <Text style={styles.clearCheckedLabel} numberOfLines={1}>{t('grocery.clearDone')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.priceHistoryButton}
                onPress={() => navigation.navigate('ReceiptImport')}
                accessibilityRole="button"
                accessibilityLabel={t('grocery.scanReceipt')}
              >
                <Ionicons name="camera-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.priceHistoryLabel} numberOfLines={1}>{t('grocery.scan')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.priceHistoryButton}
                onPress={() => navigation.navigate('PriceHistory')}
                accessibilityRole="button"
                accessibilityLabel={t('grocery.priceHistory')}
              >
                <Ionicons name="pricetags-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.priceHistoryLabel} numberOfLines={1}>{t('grocery.prices')}</Text>
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
                    {basket.loggedCount > 0 ? t('grocery.projectedTotal') : t('grocery.estimatedTotal')}
                  </Text>
                  <Text style={styles.basketTotal}>{formatPrice(basket.projected)}</Text>
                </View>
                {basket.loggedCount > 0 && (
                  <View style={styles.basketSplit}>
                    <Text style={styles.basketSplitValue}>{formatPrice(basket.actual)}</Text>
                    <Text style={styles.basketSplitLabel}>{t('grocery.inBasket')}</Text>
                  </View>
                )}
                {basket.remaining > 0 && (
                  <View style={styles.basketSplit}>
                    <Text style={styles.basketSplitValue}>{formatPrice(basket.remaining)}</Text>
                    <Text style={styles.basketSplitLabel}>{t('grocery.toGo')}</Text>
                  </View>
                )}
              </View>
              {basket.unpricedCount > 0 && (
                <Text style={styles.basketNote}>
                  {t('grocery.noPriceHistory', { count: basket.unpricedCount })}
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
              { id: 'all',       label: t('grocery.filterAll') },
              { id: 'unchecked', label: t('grocery.filterPending') },
              { id: 'checked',   label: t('grocery.filterDone') },
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
          // Web: this screen sits inside GroceryStack, and `flex: 1` never
          // resolves to a definite height through a nav stack — the list then
          // grows to fit its content and the page stops scrolling. The height
          // has to be on the scroller itself, not just an ancestor.
          style={Platform.OS === 'web'
            ? { height: Math.max(viewportHeight - headerHeight, 0) }
            : styles.list}
          // Just enough to clear the floating nav (0 on desktop — sidebar nav).
          contentContainerStyle={[styles.listContent, { paddingBottom: navClearance || spacing.xl }]}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { navScrollProps.onScroll(e); fab.onScroll(e); }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <View style={styles.emptyStateIcon}>
                <Ionicons name="cart-outline" size={36} color={colors.textTertiary} />
              </View>
              <Text style={styles.emptyStateTitle}>{t('grocery.emptyTitle')}</Text>
              <Text style={styles.emptyStateSubtitle}>{t('grocery.emptySub')}</Text>
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
                  <Text style={styles.categoryGroupLabel}>{categoryName(row.label)}</Text>
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
                        title: t('grocery.removeItem'),
                        message: t('grocery.removeItemConfirm', { name: item.name }),
                        type: 'danger',
                        confirmLabel: t('grocery.remove'),
                      });
                      if (!confirmed) return;
                      try {
                        if (item.checked) await removePantryItemByGroceryId(householdId, item.id);
                        await deleteGroceryItem(householdId, item.id);
                        notify(t('grocery.removed'), t('grocery.removedFromList', { name: item.name }), { type: 'info' });
                      } catch (e) {
                        showAlert({ title: t('common.error'), message: e.message, type: 'error' });
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
          accessibilityLabel={t('grocery.addItem')}
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
              <Text style={styles.sheetTitle}>{editingItem ? t('grocery.editItemTitle') : t('grocery.addToList')}</Text>

              <Text style={styles.inputLabel}>{t('grocery.itemName')}</Text>
              <TextInput
                style={[styles.textInput, !!errors.name && styles.inputError]}
                placeholder={t('grocery.itemNamePlaceholder')}
                value={newItemName}
                onChangeText={(text) => { setNewItemName(text); if (errors.name) setErrors((e) => ({ ...e, name: null })); }}
                placeholderTextColor={colors.textTertiary}
                autoFocus
                accessibilityLabel={t('grocery.itemNameA11y')}
              />
              {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

              <View style={styles.quantityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('grocery.quantity')}</Text>
                  <TextInput
                    style={[styles.textInput, !!errors.quantity && styles.inputError]}
                    placeholder="1"
                    value={newItemQuantity}
                    onChangeText={(text) => { setNewItemQuantity(text.replace(/[^0-9.]/g, '')); if (errors.quantity) setErrors((e) => ({ ...e, quantity: null })); }}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel={t('grocery.quantityA11y')}
                  />
                  {!!errors.quantity && <Text style={styles.errorText}>{errors.quantity}</Text>}
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.inputLabel}>{t('grocery.unit')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {[...enabledUnits, ...customUnits].map((unit) => (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.unitChip, newItemUnit === unit && styles.unitChipActive]}
                        onPress={() => setNewItemUnit(unit)}
                      >
                        <Text style={[styles.unitChipLabel, newItemUnit === unit && styles.unitChipLabelActive]}>{unitName(unit)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <Text style={styles.inputLabel}>{t('grocery.category')}</Text>
              <DragScrollView style={{ marginBottom: 4 }}>
                {visibleFoodCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.label}
                    style={[styles.categoryChip, selectedCategory === cat.label && styles.categoryChipActive]}
                    onPress={() => setSelectedCategory(cat.label)}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text style={[styles.categoryChipLabel, selectedCategory === cat.label && styles.categoryChipLabelActive]}>
                      {categoryName(cat.label)}
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
                      {categoryName(cat.label)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </DragScrollView>

              {!visibleNonFoodCategories.some((c) => c.label === selectedCategory) && (
                <>
                  <Text style={styles.inputLabel}>{t('grocery.expiryDate')}</Text>
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
                  <Text style={styles.cancelButtonLabel}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={editingItem ? handleSaveEdit : handleAddItem}>
                  <Text style={styles.confirmButtonLabel}>{editingItem ? t('grocery.saveChanges') : t('grocery.addToList')}</Text>
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
                    {t('grocery.logCost')}
                  </Text>
                </View>
              </View>

              <View style={styles.quantityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('grocery.pricePaid')}</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="0.00"
                    value={checkoutPrice}
                    onChangeText={(text) => setCheckoutPrice(text.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel={t('grocery.pricePaidA11y')}
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.inputLabel}>{t('grocery.store')}</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder={t('grocery.storePlaceholder')}
                    value={checkoutStore}
                    onChangeText={setCheckoutStore}
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel={t('grocery.store')}
                  />
                </View>
              </View>

              {/* Total for the whole quantity — restated so it's unambiguous
                  what the number covers when comparing per-unit later. */}
              {!!checkoutItem?.quantity && (
                <Text style={styles.checkoutHint}>
                  {t('grocery.totalFor', { quantity: `${checkoutItem.quantity}${checkoutItem.unit ? ` ${unitName(checkoutItem.unit)}` : ''}` })}
                  {checkoutLastEntry
                    ? (checkoutLastEntry.store
                      ? t('grocery.lastPaidAt', { price: formatPrice(checkoutLastEntry.price), store: checkoutLastEntry.store })
                      : t('grocery.lastPaid', { price: formatPrice(checkoutLastEntry.price) }))
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
                  <Text style={styles.inputLabel}>{t('grocery.expiryDate')}</Text>
                  <DatePickerInput value={checkoutExpiry} onChange={setCheckoutExpiry} />
                </>
              )}

              <View style={styles.sheetActionRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => handleCheckoutConfirm(false)}>
                  <Text style={styles.cancelButtonLabel}>{t('grocery.skip')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, !checkoutPrice && !checkoutExpiry && styles.confirmButtonDisabled]}
                  disabled={!checkoutPrice && !checkoutExpiry}
                  onPress={() => handleCheckoutConfirm(true)}
                >
                  <Text style={styles.confirmButtonLabel}>{t('common.save')}</Text>
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
  screenRoot:             { flex: 1, minHeight: 0, backgroundColor: colors.background },
  contentWrapper:         { flex: 1, minHeight: 0 },
  contentWrapperDesktop:  { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  // The list owns the space the header leaves; without an explicit flex it sizes
  // to its content and stops scrolling once the header grows.
  list: { flex: 1, minHeight: 0 },

  headerSection: {
    flexShrink: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  headerTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    flexWrap: 'wrap', gap: spacing.sm,
  },
  headerTitleBlock: { flexShrink: 1 },
  screenTitle:    { ...type.h2, color: colors.textPrimary },
  screenSubtitle: { ...type.bodySm, color: colors.textSecondary, marginTop: 3 },

  // Three pills don't fit next to the title on a phone — let them wrap to their
  // own line rather than squeezing the labels into multi-line pills.
  headerActions: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end',
  },
  clearCheckedButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
  },
  clearCheckedLabel: { ...type.label, color: colors.accent },

  priceHistoryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0,
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

  listContent: { paddingHorizontal: spacing.xl },

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
