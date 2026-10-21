import React, { useEffect, useState, useMemo, useRef, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, FlatList, SafeAreaView, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { subscribeMealPlan, setMealSlot, clearMealSlot, subscribeRecipes, getRecipe, deductPantryIngredients, getPantryItems, subscribePantryItems, getGroceryItems, addGroceryItem } from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { DAYS_OF_WEEK, FULL_DAYS, MEAL_TYPES } from '../../utils/categories';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';
import AddRecipeScreen from '../recipes/AddRecipeScreen';
import useBodyGoals from '../../hooks/useBodyGoals';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';

const getWeekKey = (date) => format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');

// Scheduled meal start times (24h). Auto-cook fires 4 h after each.
const MEAL_HOURS   = { Breakfast: 10, Lunch: 13, Dinner: 20, Snack: 23 };
const AUTO_COOK_H  = 4;

const MealTimerBadge = memo(({ status, colors, small }) => {
  if (!status) return null;

  const base = { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 };
  const txt  = (color) => ({ fontSize: 10, fontWeight: '600', color });

  if (status.state === 'cooked')
    return (
      <View style={base}>
        <Ionicons name="checkmark-circle" size={small ? 10 : 12} color={colors.sage} />
        {!small && <Text style={txt(colors.sage)}>Cooked</Text>}
      </View>
    );

  if (status.state === 'countdown') {
    const label = status.h > 0 ? `${status.h}h ${status.m}m` : `${status.m}m`;
    return (
      <View style={base}>
        <Ionicons name="timer-outline" size={small ? 10 : 11} color={colors.amber} />
        <Text style={txt(colors.amber)}>{label}</Text>
      </View>
    );
  }

  if (status.state === 'upcoming')
    return (
      <View style={base}>
        <Ionicons name="time-outline" size={small ? 10 : 11} color={colors.textTertiary} />
        {!small && <Text style={{ fontSize: 10, color: colors.textTertiary }}>{status.time}</Text>}
      </View>
    );

  if (status.state === 'missed')
    return (
      <View style={base}>
        <Ionicons name="alert-circle-outline" size={small ? 10 : 12} color={colors.danger} />
        {!small && <Text style={txt(colors.danger)}>Missed</Text>}
      </View>
    );

  return null;
});

export default function NutritionScreen({ navigation }) {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const navScrollProps = useNavScrollProps();
  const { showOptions, showConfirm, showAlert } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const contentKey = useEntranceReplay();
  const windowHeight = useVisualViewportHeight();
  const body = useBodyGoals(householdId, user?.uid);
  const calorieTarget = body.calories?.target ?? null;

  const [currentWeek, setCurrentWeek]     = useState(new Date());
  const [mealPlan, setMealPlan]           = useState({});
  const [savedRecipes, setSavedRecipes]   = useState([]);
  const [modalVisible, setModalVisible]   = useState(false);
  const [addRecipeVisible, setAddRecipeVisible] = useState(false);
  const [selectedSlot, setSelectedSlot]   = useState(null);
  const [isReplacing, setIsReplacing]       = useState(false);
  const [recipeDropdownOpen, setRecipeDropdownOpen] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [pendingRecipe, setPendingRecipe] = useState(null);
  const [originalSlot, setOriginalSlot] = useState(null);
  const [originalMeal, setOriginalMeal] = useState(null);

  const [pantryItems, setPantryItems]                 = useState([]);
  const [pantryDropdownOpen, setPantryDropdownOpen]   = useState(false);
  const [pantrySearch, setPantrySearch]               = useState('');
  const [pendingPantryItem, setPendingPantryItem]     = useState(null);
  const [pantryAmount, setPantryAmount]               = useState('1');
  const [pantryCalories, setPantryCalories]           = useState('');

  const [now, setNow] = useState(() => new Date());
  const autoCookedRef  = useRef(new Set());

  const [shopModalVisible, setShopModalVisible] = useState(false);
  const [shopItems, setShopItems]               = useState([]);
  const [shopCoveredCount, setShopCoveredCount] = useState(0);
  const [shopLoading, setShopLoading]           = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const weekKey        = getWeekKey(currentWeek);
  const weekStart      = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const isCurrentWeek  = weekKey === getWeekKey(new Date());

  const mealTypeColors = {
    Breakfast: { bg: colors.amberSoft,  text: colors.amber          },
    Lunch:     { bg: colors.sageSoft,   text: colors.sage           },
    Dinner:    { bg: colors.accentSoft, text: colors.accent         },
    Snack:     { bg: colors.muted,      text: colors.textSecondary  },
  };

  useEffect(() => {
    if (!householdId) return;
    return subscribeMealPlan(householdId, weekKey, setMealPlan);
  }, [householdId, weekKey]);

  useEffect(() => {
    if (!householdId) return;
    return subscribeRecipes(householdId, setSavedRecipes);
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    return subscribePantryItems(householdId, setPantryItems);
  }, [householdId]);

  const getMeal = (day, mealType) => mealPlan[day]?.[mealType] || null;

  // Resets every picker field in the add/replace sheet.
  const resetPicker = () => {
    setRecipeDropdownOpen(false);
    setRecipeSearch('');
    setPendingRecipe(null);
    setPantryDropdownOpen(false);
    setPantrySearch('');
    setPendingPantryItem(null);
    setPantryAmount('1');
    setPantryCalories('');
  };

  const handleSlotPress = async (day, mealType) => {
    const existingMeal = getMeal(day, mealType);
    if (existingMeal) {
      const cookOption = existingMeal.cooked
        ? null
        : { label: existingMeal.pantryItemId ? 'Mark as Eaten' : 'Mark as Cooked', value: 'cook' };

      const action = await showOptions({
        title: existingMeal.name,
        type: 'warning',
        options: [
          ...(cookOption ? [cookOption] : []),
          { label: 'Replace', value: 'replace' },
          { label: 'Remove', value: 'remove', style: 'destructive' },
          { label: 'Cancel', value: null, style: 'cancel' },
        ],
      });
      if (action === 'cook') {
        try {
          const deductions = [];
          let confirmMessage = '';

          if (existingMeal.pantryItemId) {
            // Single pantry product — deduct the planned amount from that item.
            const amount = parseFloat(existingMeal.amount) || 0;
            const item   = pantryItems.find((p) => p.id === existingMeal.pantryItemId) ?? null;
            if (item && amount > 0) {
              deductions.push({ pantryItemId: item.id, amount });
              confirmMessage = `Deduct ${amount} ${existingMeal.unit || item.unit || 'pcs'} of "${item.name}" from the pantry?`;
            }
          } else {
            const recipe = existingMeal.recipeId
              ? await getRecipe(householdId, existingMeal.recipeId)
              : null;

            const ingredients = (recipe?.ingredients ?? []).filter(
              (i) => i.name?.trim() && parseFloat(i.amount) > 0,
            );

            const currentPantry = ingredients.length > 0 ? await getPantryItems(householdId) : [];

            for (const ing of ingredients) {
              let match = null;

              // Try the saved link first
              if (ing.pantryItemId) {
                match = currentPantry.find((p) => p.id === ing.pantryItemId) ?? null;
              }

              // Fallback: search by name
              if (!match) {
                const byName = currentPantry.filter((p) => normName(p.name) === normName(ing.name));
                if (byName.length === 1) {
                  match = byName[0];
                } else if (byName.length > 1) {
                  const chosen = await showOptions({
                    title: `Which "${ing.name}"?`,
                    message: `Multiple pantry items match "${ing.name}" (${ing.amount} ${ing.unit}). Pick one or skip.`,
                    type: 'info',
                    options: [
                      ...byName.map((p) => ({
                        label: `${p.name}  ·  ${p.quantity} ${p.unit}`,
                        value: p.id,
                      })),
                      { label: 'Skip this ingredient', value: 'skip' },
                      { label: 'Cancel', value: null, style: 'cancel' },
                    ],
                  });
                  if (chosen === null) return;
                  if (chosen !== 'skip') {
                    match = byName.find((p) => p.id === chosen) ?? null;
                  }
                }
              }

              if (match) deductions.push({ pantryItemId: match.id, amount: ing.amount });
            }

            confirmMessage = `Deduct ${deductions.length} pantry item${deductions.length !== 1 ? 's' : ''} used in "${existingMeal.name}"?`;
          }

          if (deductions.length > 0) {
            const confirmed = await showConfirm({
              title: 'Mark as Cooked',
              message: confirmMessage,
              confirmLabel: existingMeal.pantryItemId ? 'Eat' : 'Cook',
              type: 'info',
            });
            if (!confirmed) return;
            await deductPantryIngredients(householdId, deductions);
          }

          await setMealSlot(householdId, weekKey, day, mealType, { ...existingMeal, cooked: true });
          notify(
            existingMeal.pantryItemId ? 'Eaten!' : 'Cooked!',
            deductions.length > 0
              ? `${deductions.length} pantry item${deductions.length !== 1 ? 's' : ''} deducted.`
              : `"${existingMeal.name}" marked as done.`,
            { type: 'success' },
          );
        } catch (e) {
          showAlert({ title: 'Error', message: e.message, type: 'error' });
        }
      } else if (action === 'remove') {
        const confirmed = await showConfirm({
          title: 'Remove meal',
          message: `Remove "${existingMeal.name}" from ${day} ${mealType}?`,
          type: 'danger',
          confirmLabel: 'Remove',
        });
        if (!confirmed) return;
        await clearMealSlot(householdId, weekKey, day, mealType);
        notify('Meal removed', `${existingMeal.name} removed.`, { type: 'info' });
      } else if (action === 'replace') {
        setIsReplacing(true);
        setSelectedSlot({ day, mealType });
        setOriginalSlot({ day, mealType });
        setOriginalMeal(existingMeal);
        resetPicker();
        if (existingMeal.pantryItemId) {
          // Prefill the pantry picker with what's already in the slot.
          const item = pantryItems.find((p) => p.id === existingMeal.pantryItemId);
          setPendingPantryItem(item ?? {
            id: existingMeal.pantryItemId,
            name: existingMeal.name,
            unit: existingMeal.unit || 'pcs',
          });
          setPantryAmount(String(existingMeal.amount ?? 1));
          setPantryCalories(existingMeal.calories ? String(existingMeal.calories) : '');
        }
        setModalVisible(true);
      }
    } else {
      setIsReplacing(false);
      setSelectedSlot({ day, mealType });
      setOriginalSlot(null);
      setOriginalMeal(null);
      resetPicker();
      setModalVisible(true);
    }
  };

  const handlePickRecipe = async (recipe) => {
    await setMealSlot(householdId, weekKey, selectedSlot.day, selectedSlot.mealType, {
      name: recipe.title, recipeId: recipe.id, calories: recipe.calories || 0,
    });
    notify(
      isReplacing ? 'Meal updated' : 'Meal added',
      `${recipe.title} added to ${selectedSlot.day} ${selectedSlot.mealType}.`,
      { type: 'success' },
    );
    closeModal();
  };

  // A single pantry product planned as a meal (yogurt, a piece of fruit, …).
  const buildPantryMeal = () => ({
    name:         pendingPantryItem.name,
    recipeId:     null,
    pantryItemId: pendingPantryItem.id,
    amount:       parseFloat(pantryAmount) > 0 ? parseFloat(pantryAmount) : 1,
    unit:         pendingPantryItem.unit || 'pcs',
    calories:     parseInt(pantryCalories, 10) || 0,
  });

  const handleAddPantryMeal = async () => {
    const mealData = buildPantryMeal();
    await setMealSlot(householdId, weekKey, selectedSlot.day, selectedSlot.mealType, mealData);
    notify(
      'Meal added',
      `${mealData.amount} ${mealData.unit} of ${mealData.name} added to ${selectedSlot.day} ${selectedSlot.mealType}.`,
      { type: 'success' },
    );
    closeModal();
  };

  const closeModal = () => {
    setModalVisible(false);
    resetPicker();
    setOriginalSlot(null);
    setOriginalMeal(null);
  };

  const handleConfirmUpdate = async () => {
    const mealData = pendingRecipe
      ? { name: pendingRecipe.title, recipeId: pendingRecipe.id, calories: pendingRecipe.calories || 0 }
      : pendingPantryItem
        ? buildPantryMeal()
        : { name: originalMeal.name, recipeId: originalMeal.recipeId ?? null, calories: originalMeal.calories ?? 0 };

    await setMealSlot(householdId, weekKey, selectedSlot.day, selectedSlot.mealType, mealData);

    const slotChanged =
      originalSlot.day !== selectedSlot.day ||
      originalSlot.mealType !== selectedSlot.mealType;

    if (slotChanged) {
      await clearMealSlot(householdId, weekKey, originalSlot.day, originalSlot.mealType);
    }

    const movedType = originalSlot.mealType !== selectedSlot.mealType;
    notify(
      'Meal updated',
      movedType
        ? `${mealData.name} moved to ${selectedSlot.mealType}.`
        : `${mealData.name} updated in ${selectedSlot.day} ${selectedSlot.mealType}.`,
      { type: 'success' },
    );
    closeModal();
  };

  const handleAddNewRecipe = () => {
    setModalVisible(false);
    resetPicker();
    setAddRecipeVisible(true);
  };

  const normName = (s) => (s || '').trim().toLowerCase();

  const handleGenerateGroceryList = async () => {
    setShopLoading(true);
    try {
      const recipeIds     = new Set();
      const singleProducts = [];
      FULL_DAYS.forEach((day) => {
        MEAL_TYPES.forEach((mt) => {
          const meal = getMeal(day, mt);
          if (!meal) return;
          if (meal.recipeId) {
            recipeIds.add(meal.recipeId);
          } else if (meal.pantryItemId) {
            singleProducts.push({ name: meal.name, amount: meal.amount ?? 1, unit: meal.unit || 'pcs' });
          }
        });
      });

      if (recipeIds.size === 0 && singleProducts.length === 0) {
        showAlert({ title: 'Nothing planned', message: 'Add meals with saved recipes or pantry products to this week first.', type: 'info' });
        return;
      }

      const recipes = await Promise.all([...recipeIds].map((id) => getRecipe(householdId, id)));

      const seen = new Set();
      const allIngredients = [];
      for (const recipe of recipes) {
        if (!recipe?.ingredients) continue;
        for (const ing of recipe.ingredients) {
          if (!ing.name?.trim()) continue;
          const key = normName(ing.name);
          if (!seen.has(key)) { seen.add(key); allIngredients.push(ing); }
        }
      }
      for (const product of singleProducts) {
        if (!product.name?.trim()) continue;
        const key = normName(product.name);
        if (!seen.has(key)) { seen.add(key); allIngredients.push(product); }
      }

      if (allIngredients.length === 0) {
        showAlert({ title: 'No ingredients', message: 'The planned recipes have no ingredients listed.', type: 'info' });
        return;
      }

      const [pantryItems, groceryItems] = await Promise.all([
        getPantryItems(householdId),
        getGroceryItems(householdId),
      ]);

      const toAdd = [];
      let covered = 0;
      for (const ing of allIngredients) {
        const inPantry = pantryItems.some((p) => normName(p.name) === normName(ing.name));
        const onList   = groceryItems.some((g) => !g.checked && normName(g.name) === normName(ing.name));
        if (inPantry || onList) { covered++; } else { toAdd.push(ing); }
      }

      setShopItems(toAdd);
      setShopCoveredCount(covered);
      setShopModalVisible(true);
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setShopLoading(false);
    }
  };

  const handleConfirmShop = async () => {
    try {
      await Promise.all(shopItems.map((ing) =>
        addGroceryItem(householdId, {
          name: ing.name.trim(),
          quantity: ing.amount ? String(ing.amount) : '1',
          unit: ing.unit || 'pcs',
          category: 'Other',
          expiryDate: null,
          addedBy: user?.uid ?? null,
        }),
      ));
      notify(
        'Added to grocery list',
        `${shopItems.length} ingredient${shopItems.length !== 1 ? 's' : ''} added.`,
        { type: 'success' },
      );
      setShopModalVisible(false);
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const filteredRecipes = useMemo(
    () => savedRecipes.filter((r) =>
      r.title.toLowerCase().includes(recipeSearch.toLowerCase())
    ),
    [savedRecipes, recipeSearch],
  );

  const filteredPantryItems = useMemo(
    () => pantryItems
      .filter((p) => (p.name || '').toLowerCase().includes(pantrySearch.toLowerCase()))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [pantryItems, pantrySearch],
  );

  const getDayCalories    = (day) => MEAL_TYPES.reduce((sum, mt) => sum + (getMeal(day, mt)?.calories || 0), 0);
  const totalWeekCalories = FULL_DAYS.reduce((sum, day) => sum + getDayCalories(day), 0);
  const totalMealsPlanned = FULL_DAYS.reduce((sum, day) => sum + MEAL_TYPES.filter((mt) => getMeal(day, mt)).length, 0);
  const todayDateKey      = format(now, 'yyyy-MM-dd');
  const maxDayCalories    = Math.max(...FULL_DAYS.map(getDayCalories), 1);
  // Planned vs the signed-in member's target, e.g. "1,850 / 2,100 cal".
  const isOverTarget = (cal) => calorieTarget != null && cal > calorieTarget;
  const fmtDayCalories = (cal, compact = false) => {
    if (calorieTarget == null) return `${cal} cal`;
    return compact ? `${cal}/${calorieTarget}` : `${cal.toLocaleString()} / ${calorieTarget.toLocaleString()} cal`;
  };

  const getMealTimerStatus = (dayIndex, mealType, meal) => {
    if (!meal) return null;
    if (meal.cooked) return { state: 'cooked' };

    const date         = addDays(weekStart, dayIndex);
    const mealTime     = new Date(date); mealTime.setHours(MEAL_HOURS[mealType], 0, 0, 0);
    const autoCookTime = new Date(mealTime.getTime() + AUTO_COOK_H * 3_600_000);

    if (format(date, 'yyyy-MM-dd') === todayDateKey) {
      if (now >= autoCookTime) return { state: 'cooked' };
      if (now >= mealTime) {
        const msLeft = autoCookTime - now;
        const h = Math.floor(msLeft / 3_600_000);
        const m = Math.max(1, Math.ceil((msLeft % 3_600_000) / 60_000));
        return { state: 'countdown', h, m };
      }
      const h = MEAL_HOURS[mealType];
      return { state: 'upcoming', time: `${h < 10 ? '0' : ''}${h}:00` };
    }

    // Other days: auto-cook only runs for today, so anything past its window
    // that is still uncooked was never eaten.
    if (now >= autoCookTime) return { state: 'missed' };
    return null;
  };

  // Cooked / missed tallies, used by the day badges and the week summary.
  const getDayProgress = (day, dayIndex) => {
    let total = 0, done = 0, missed = 0;
    MEAL_TYPES.forEach((mealType) => {
      const meal = getMeal(day, mealType);
      if (!meal) return;
      total += 1;
      const state = getMealTimerStatus(dayIndex, mealType, meal)?.state;
      if (state === 'cooked')      done   += 1;
      else if (state === 'missed') missed += 1;
    });
    return { total, done, missed };
  };

  const weekProgress = FULL_DAYS.reduce((acc, day, dayIndex) => {
    const { total, done, missed } = getDayProgress(day, dayIndex);
    return { total: acc.total + total, done: acc.done + done, missed: acc.missed + missed };
  }, { total: 0, done: 0, missed: 0 });

  const cookMeal = async (day, mealType, meal) => {
    if (meal.pantryItemId) {
      const deducted = await deductPantryIngredients(householdId, [
        { pantryItemId: meal.pantryItemId, amount: meal.amount ?? 1 },
      ]);
      await setMealSlot(householdId, weekKey, day, mealType, { ...meal, cooked: true });
      return deducted;
    }

    const recipe = meal.recipeId ? await getRecipe(householdId, meal.recipeId) : null;
    if (recipe?.ingredients?.length) {
      await deductPantryIngredients(householdId, recipe.ingredients);
    }
    await setMealSlot(householdId, weekKey, day, mealType, { ...meal, cooked: true });
    return recipe?.ingredients?.filter(i => i.pantryItemId)?.length ?? 0;
  };

  // Auto-cook: runs every 30 s; placed after todayDateKey and cookMeal to avoid TDZ errors
  useEffect(() => {
    if (!isCurrentWeek || !householdId) return;
    FULL_DAYS.forEach((day, dayIndex) => {
      const date = addDays(weekStart, dayIndex);
      if (format(date, 'yyyy-MM-dd') !== todayDateKey) return;
      MEAL_TYPES.forEach(async (mealType) => {
        const meal = mealPlan[day]?.[mealType];
        if (!meal || meal.cooked) return;
        const mealTime     = new Date(date); mealTime.setHours(MEAL_HOURS[mealType], 0, 0, 0);
        const autoCookTime = new Date(mealTime.getTime() + AUTO_COOK_H * 3_600_000);
        if (now < autoCookTime) return;
        const key = `${weekKey}-${day}-${mealType}`;
        if (autoCookedRef.current.has(key)) return;
        autoCookedRef.current.add(key);
        try {
          await cookMeal(day, mealType, meal);
          notify('Auto-cooked', `"${meal.name}" was marked as cooked automatically.`, { type: 'info' });
        } catch { autoCookedRef.current.delete(key); }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, mealPlan, isCurrentWeek, householdId, weekKey, todayDateKey]);

  const canUpdate = isReplacing && (
    !!pendingRecipe ||
    !!pendingPantryItem ||
    (originalSlot && selectedSlot?.mealType !== originalSlot?.mealType)
  );

  const desktopContentWrapper = isDesktop
    ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%', flex: 1 }
    : { flex: 1 };

  const header = (
    <>
      <View style={styles.headerSection}>
        <Text style={styles.screenTitle}>Nutrition</Text>
        <View style={styles.weekNavigator}>
          {!isCurrentWeek && (
            <TouchableOpacity
              onPress={() => setCurrentWeek(new Date())}
              style={styles.todayButton}
              accessibilityRole="button"
              accessibilityLabel="Go to current week"
            >
              <Text style={styles.todayButtonLabel}>Today</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setCurrentWeek((w) => subWeeks(w, 1))}
            style={styles.weekArrowButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          {isDesktop ? (
            <input
              type="date"
              value={format(weekStart, 'yyyy-MM-dd')}
              onChange={(e) => {
                if (e.target.value) setCurrentWeek(new Date(e.target.value + 'T12:00:00'));
              }}
              style={{
                height: 32,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                paddingLeft: 10,
                paddingRight: 10,
                backgroundColor: colors.surface,
                color: colors.textPrimary,
                fontSize: 13,
                cursor: 'pointer',
                outline: 'none',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              }}
            />
          ) : (
            <Text style={styles.weekRangeLabel}>
              {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => setCurrentWeek((w) => addWeeks(w, 1))}
            style={styles.weekArrowButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.summaryStatsRow}>
        <View style={styles.summaryStatCard}>
          <Text style={styles.summaryStatValue}>
            {totalMealsPlanned > 0 ? `${weekProgress.done}/${totalMealsPlanned}` : '—'}
          </Text>
          <Text style={styles.summaryStatLabel}>Meals done</Text>
          {totalMealsPlanned > 0 && (
            <View style={styles.progressTrack}>
              <View style={[
                styles.progressFill,
                { width: `${Math.round((weekProgress.done / totalMealsPlanned) * 100)}%` },
              ]} />
            </View>
          )}
        </View>
        <View style={styles.summaryStatCard}>
          <Text style={styles.summaryStatValue}>{totalWeekCalories > 0 ? totalWeekCalories.toLocaleString() : '—'}</Text>
          <Text style={styles.summaryStatLabel}>Cal this week</Text>
        </View>
        <View style={styles.summaryStatCard}>
          <Text style={styles.summaryStatValue}>{totalWeekCalories > 0 ? Math.round(totalWeekCalories / 7) : '—'}</Text>
          <Text style={styles.summaryStatLabel}>Cal / day avg</Text>
        </View>
      </View>

      {!body.loading && !body.error && (
        <TouchableOpacity
          style={styles.targetCard}
          onPress={() => navigation.navigate('BodyGoals')}
          accessibilityRole="button"
          accessibilityLabel="Open body and goals"
        >
          <View style={styles.targetIcon}>
            <Ionicons name="body-outline" size={18} color={colors.accent} />
          </View>
          {calorieTarget != null ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.targetValue}>{calorieTarget.toLocaleString()} kcal / day</Text>
              <Text style={styles.targetMeta}>
                Your target · {Math.round(body.currentWeight * 10) / 10} kg
                {body.profile?.goal && body.profile.goal !== 'maintain'
                  ? ` · ${body.profile.goal === 'lose' ? 'losing' : 'gaining'} ${body.profile.weeklyRateKg} kg/wk`
                  : ' · maintaining'}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.targetValue}>Body & goals</Text>
              <Text style={styles.targetMeta}>
                {body.profile ? 'Log your weight' : 'Add your height, weight and goal'} to get a daily calorie target
              </Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.generateShopButton}
        onPress={handleGenerateGroceryList}
        disabled={shopLoading}
        accessibilityRole="button"
        accessibilityLabel="Add week's ingredients to grocery list"
      >
        {shopLoading
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <Ionicons name="cart-outline" size={15} color={colors.accent} />
        }
        <Text style={styles.generateShopButtonLabel}>Add week's ingredients to grocery list</Text>
      </TouchableOpacity>

      {totalMealsPlanned > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.chartHeading}>Calories / day</Text>
          <View style={styles.chartRow}>
            {FULL_DAYS.map((day, dayIndex) => {
              const date    = addDays(weekStart, dayIndex);
              const isToday = format(date, 'yyyy-MM-dd') === todayDateKey;
              const cal     = getDayCalories(day);
              const barH    = cal > 0 ? Math.max((cal / maxDayCalories) * 72, 6) : 3;
              return (
                <View key={day} style={styles.chartCol}>
                  <Text style={[styles.chartCalText, { color: cal > 0 ? (isToday ? colors.accent : colors.textSecondary) : 'transparent' }]}>
                    {cal >= 1000 ? `${(cal / 1000).toFixed(1)}k` : cal > 0 ? String(cal) : '0'}
                  </Text>
                  <View style={styles.chartBarTrack}>
                    <View style={[
                      styles.chartBar,
                      { height: barH },
                      isToday && cal > 0  ? { backgroundColor: colors.accent } :
                      cal > 0             ? { backgroundColor: colors.accentSoft } :
                                            { backgroundColor: colors.border },
                    ]} />
                  </View>
                  <Text style={[styles.chartDayText, isToday && { color: colors.accent, fontWeight: '700' }]}>
                    {DAYS_OF_WEEK[dayIndex]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </>
  );

  const mobileDayCards = FULL_DAYS.map((day, dayIndex) => {
    const date        = addDays(weekStart, dayIndex);
    const dateKey     = format(date, 'yyyy-MM-dd');
    const isToday     = dateKey === todayDateKey;
    const isPast      = dateKey < todayDateKey;
    const dayCalories = getDayCalories(day);
    const dayProgress = getDayProgress(day, dayIndex);
    return (
      <Rise key={day} index={dayIndex + 1} style={[styles.dayCard, isToday && styles.dayCardToday, isPast && styles.dayCardPast]}>
        <View style={[styles.dayCardHeader, isToday && styles.dayCardHeaderToday]}>
          <View>
            <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
              {DAYS_OF_WEEK[dayIndex]}
            </Text>
            <Text style={styles.dayDateLabel}>{format(date, 'MMM d')}</Text>
          </View>
          <View style={styles.dayCardHeaderRight}>
            {dayProgress.total > 0 && (
              <View style={[
                styles.dayStatusBadge,
                dayProgress.done === dayProgress.total ? styles.dayStatusBadgeDone
                  : dayProgress.missed > 0             ? styles.dayStatusBadgeMissed
                                                       : null,
              ]}>
                <Ionicons
                  name={
                    dayProgress.done === dayProgress.total ? 'checkmark-circle'
                      : dayProgress.missed > 0             ? 'alert-circle'
                                                           : 'ellipse-outline'
                  }
                  size={11}
                  color={
                    dayProgress.done === dayProgress.total ? colors.sage
                      : dayProgress.missed > 0             ? colors.danger
                                                           : colors.textTertiary
                  }
                />
                <Text style={[
                  styles.dayStatusBadgeText,
                  dayProgress.done === dayProgress.total ? { color: colors.sage }
                    : dayProgress.missed > 0             ? { color: colors.danger }
                                                         : null,
                ]}>
                  {dayProgress.done}/{dayProgress.total}
                </Text>
              </View>
            )}
            {dayCalories > 0 && (
              <View style={[
                styles.calorieBadge,
                isToday && styles.calorieBadgeToday,
                isOverTarget(dayCalories) && styles.calorieBadgeOver,
              ]}>
                <Text style={[
                  styles.calorieBadgeText,
                  isToday && styles.calorieBadgeTextToday,
                  isOverTarget(dayCalories) && styles.calorieBadgeTextOver,
                ]}>
                  {fmtDayCalories(dayCalories)}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.mealSlotsGrid}>
          {MEAL_TYPES.map((mealType) => {
            const meal       = getMeal(day, mealType);
            const mealColor  = mealTypeColors[mealType];
            const timerStatus = getMealTimerStatus(dayIndex, mealType, meal);
            const isCooked   = timerStatus?.state === 'cooked';
            const isMissed   = timerStatus?.state === 'missed';
            return (
              <TouchableOpacity
                key={mealType}
                style={[
                  styles.mealSlot,
                  meal && { backgroundColor: mealColor.bg },
                  isCooked && styles.mealSlotCooked,
                  isMissed && styles.mealSlotMissed,
                ]}
                onPress={() => handleSlotPress(day, mealType)}
                accessibilityRole="button"
                accessibilityLabel={`${day} ${mealType}: ${meal ? `${meal.name}${isCooked ? ', cooked' : isMissed ? ', missed' : ''}` : 'empty, tap to add'}`}
              >
                <Text style={[
                  styles.mealTypeLabel,
                  meal && { color: mealColor.text },
                  isCooked && { color: colors.sage },
                  isMissed && { color: colors.danger },
                ]}>
                  {mealType}
                </Text>
                {meal ? (
                  <>
                    <Text
                      style={[
                        styles.mealName,
                        { color: mealColor.text },
                        isCooked && styles.mealNameCooked,
                        isMissed && styles.mealNameMissed,
                      ]}
                      numberOfLines={1}
                    >
                      {meal.name}
                    </Text>
                    {meal.pantryItemId && (
                      <Text style={styles.mealPortion} numberOfLines={1}>
                        {meal.amount ?? 1} {meal.unit || 'pcs'}
                      </Text>
                    )}
                    <MealTimerBadge status={timerStatus} colors={colors} />
                  </>
                ) : (
                  <View style={styles.mealEmptyRow}>
                    <Ionicons name="add" size={12} color={colors.textTertiary} />
                    <Text style={styles.mealEmptyLabel}>Add</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </Rise>
    );
  });

  return (
    <SafeAreaView style={[styles.screenRoot, Platform.OS === 'web' && { height: windowHeight }]}>
      {isDesktop ? (
        <View key={contentKey} style={desktopContentWrapper}>
          <Rise index={0}>{header}</Rise>
          <Rise index={1}>
          <View style={styles.desktopGrid}>
            <View style={styles.desktopGridRow}>
              <View style={styles.desktopCornerCell} />
              {FULL_DAYS.map((day, dayIndex) => {
                const date        = addDays(weekStart, dayIndex);
                const dateKey     = format(date, 'yyyy-MM-dd');
                const isToday     = dateKey === todayDateKey;
                const dayCalories = getDayCalories(day);
                const isPast      = dateKey < todayDateKey;
                const dayProgress = getDayProgress(day, dayIndex);
                return (
                  <View key={day} style={[
                    styles.desktopDayHeaderCell,
                    isToday && styles.desktopDayHeaderCellToday,
                    isPast && styles.desktopDayHeaderCellPast,
                  ]}>
                    <Text style={[styles.desktopDayAbbr, isToday && styles.desktopDayAbbrToday]}>
                      {DAYS_OF_WEEK[dayIndex]}
                    </Text>
                    <Text style={styles.desktopDayDate}>{format(date, 'MMM d')}</Text>
                    {dayProgress.total > 0 && (
                      <View style={styles.desktopDayProgressRow}>
                        <Ionicons
                          name={
                            dayProgress.done === dayProgress.total ? 'checkmark-circle'
                              : dayProgress.missed > 0             ? 'alert-circle'
                                                                   : 'ellipse-outline'
                          }
                          size={10}
                          color={
                            dayProgress.done === dayProgress.total ? colors.sage
                              : dayProgress.missed > 0             ? colors.danger
                                                                   : colors.textTertiary
                          }
                        />
                        <Text style={[
                          styles.desktopDayProgressText,
                          dayProgress.done === dayProgress.total ? { color: colors.sage }
                            : dayProgress.missed > 0             ? { color: colors.danger }
                                                                 : null,
                        ]}>
                          {dayProgress.done}/{dayProgress.total}
                        </Text>
                      </View>
                    )}
                    {dayCalories > 0 && (
                      <Text style={[
                        styles.desktopDayCalories,
                        isToday && styles.desktopDayCaloriesToday,
                        isOverTarget(dayCalories) && styles.calorieBadgeTextOver,
                      ]}>
                        {fmtDayCalories(dayCalories, true)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
            {MEAL_TYPES.map((mealType) => {
              const mealColor = mealTypeColors[mealType];
              return (
                <View key={mealType} style={styles.desktopGridRow}>
                  <View style={[styles.desktopMealLabelCell, { backgroundColor: mealColor.bg }]}>
                    <Text style={[styles.desktopMealLabel, { color: mealColor.text }]}>{mealType}</Text>
                  </View>
                  {FULL_DAYS.map((day, dayIndex) => {
                    const date        = addDays(weekStart, dayIndex);
                    const dateKey     = format(date, 'yyyy-MM-dd');
                    const isToday     = dateKey === todayDateKey;
                    const meal        = getMeal(day, mealType);
                    const timerStatus = getMealTimerStatus(dayIndex, mealType, meal);
                    const isCooked    = timerStatus?.state === 'cooked';
                    const isMissed    = timerStatus?.state === 'missed';
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.desktopMealCell,
                          isToday && styles.desktopMealCellToday,
                          meal && { backgroundColor: mealColor.bg },
                          isCooked && styles.mealSlotCooked,
                          isMissed && styles.mealSlotMissed,
                        ]}
                        onPress={() => handleSlotPress(day, mealType)}
                        accessibilityRole="button"
                        accessibilityLabel={`${day} ${mealType}: ${meal ? `${meal.name}${isCooked ? ', cooked' : isMissed ? ', missed' : ''}` : 'empty, tap to add'}`}
                      >
                        {meal ? (
                          <>
                            <Text
                              style={[
                                styles.desktopMealName,
                                { color: mealColor.text },
                                isCooked && styles.mealNameCooked,
                                isMissed && styles.mealNameMissed,
                              ]}
                              numberOfLines={2}
                            >
                              {meal.name}
                            </Text>
                            <MealTimerBadge status={timerStatus} colors={colors} small />
                          </>
                        ) : (
                          <Ionicons name="add" size={13} color={colors.textTertiary} style={{ opacity: 0.4 }} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </View>
          </Rise>
        </View>
      ) : (
        <ScrollView key={contentKey} style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }} contentContainerStyle={styles.mobileContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" {...navScrollProps}>
          <Rise index={0}>{header}</Rise>
          <View style={styles.dayGrid}>
            {mobileDayCards}
          </View>
        </ScrollView>
      )}

      <Modal visible={shopModalVisible} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShopModalVisible(false)} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetDragHandle} />
            <Text style={styles.sheetTitle}>
              {shopItems.length > 0
                ? `Add ${shopItems.length} ingredient${shopItems.length !== 1 ? 's' : ''}`
                : 'Nothing to add'}
            </Text>

            {shopCoveredCount > 0 && (
              <View style={styles.shopCoveredNote}>
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.sage} />
                <Text style={styles.shopCoveredNoteText}>
                  {shopCoveredCount} already in pantry or on your list
                </Text>
              </View>
            )}

            {shopItems.length > 0 ? (
              <>
                <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                  {shopItems.map((ing, i) => (
                    <View key={i} style={styles.shopIngRow}>
                      <Ionicons name="ellipse" size={6} color={colors.accent} />
                      <Text style={styles.shopIngName} numberOfLines={1}>{ing.name}</Text>
                      {(ing.amount || ing.unit) ? (
                        <Text style={styles.shopIngAmount}>{ing.amount} {ing.unit}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { flex: 1 }]}
                    onPress={() => setShopModalVisible(false)}
                  >
                    <Text style={styles.cancelButtonLabel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.updateButton, { flex: 2 }]}
                    onPress={handleConfirmShop}
                  >
                    <Ionicons name="cart" size={16} color="#fff" />
                    <Text style={styles.updateButtonLabel}>Add to Grocery List</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.cancelButton, { flex: 1 }]}
                  onPress={() => setShopModalVisible(false)}
                >
                  <Text style={styles.cancelButtonLabel}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeModal} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetDragHandle} />
            <Text style={styles.sheetTitle}>
              {selectedSlot ? selectedSlot.day : ''}
            </Text>

            {/* Meal type picker */}
            <View style={styles.mealTypeChipRow}>
              {MEAL_TYPES.map((mt) => {
                const isActive  = selectedSlot?.mealType === mt;
                const mtColor   = mealTypeColors[mt];
                return (
                  <TouchableOpacity
                    key={mt}
                    style={[
                      styles.mealTypeChip,
                      isActive && { backgroundColor: mtColor.bg, borderColor: mtColor.text },
                    ]}
                    onPress={() => setSelectedSlot((s) => ({ ...s, mealType: mt }))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.mealTypeChipLabel, isActive && { color: mtColor.text }]}>
                      {mt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Recipe dropdown — primary choice */}
            {savedRecipes.length > 0 && (
              <View>
                <TouchableOpacity
                  style={[
                    styles.dropdownTrigger,
                    recipeDropdownOpen && styles.dropdownTriggerOpen,
                  ]}
                  onPress={() => {
                    setRecipeDropdownOpen((v) => !v);
                    setRecipeSearch('');
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Pick a recipe"
                  accessibilityState={{ expanded: recipeDropdownOpen }}
                >
                  <View style={styles.dropdownTriggerLeft}>
                    <Ionicons
                      name={pendingRecipe ? 'book' : 'book-outline'}
                      size={15}
                      color={pendingRecipe ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.dropdownTriggerLabel, pendingRecipe && { color: colors.accent }]} numberOfLines={1}>
                      {pendingRecipe ? pendingRecipe.title : 'Pick a recipe'}
                    </Text>
                  </View>
                  <View style={styles.dropdownTriggerRight}>
                    <Text style={styles.dropdownCount}>{savedRecipes.length}</Text>
                    <Ionicons
                      name={recipeDropdownOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={colors.textTertiary}
                    />
                  </View>
                </TouchableOpacity>

                {recipeDropdownOpen && (
                  <View style={[styles.dropdownPanel, { borderColor: colors.border }]}>
                    {/* Search row */}
                    <View style={[styles.dropdownSearch, { borderBottomColor: colors.border }]}>
                      <Ionicons name="search-outline" size={14} color={colors.textTertiary} />
                      <TextInput
                        style={[styles.dropdownSearchInput, { color: colors.textPrimary }]}
                        placeholder="Search recipes…"
                        placeholderTextColor={colors.textTertiary}
                        value={recipeSearch}
                        onChangeText={setRecipeSearch}
                        autoFocus
                      />
                      {recipeSearch.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setRecipeSearch('')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={14} color={colors.textTertiary} />
                        </TouchableOpacity>
                      )}
                    </View>

                    <FlatList
                      data={filteredRecipes}
                      keyExtractor={(r) => r.id}
                      style={{ maxHeight: 200 }}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      ListEmptyComponent={
                        <Text style={[styles.dropdownEmpty, { color: colors.textTertiary }]}>
                          No recipes match "{recipeSearch}"
                        </Text>
                      }
                      renderItem={({ item: recipe, index }) => {
                        const isSelected = pendingRecipe?.id === recipe.id;
                        return (
                          <TouchableOpacity
                            style={[
                              styles.dropdownItem,
                              { borderBottomColor: colors.border },
                              index === filteredRecipes.length - 1 && { borderBottomWidth: 0 },
                              isSelected && { backgroundColor: colors.accentSoft },
                            ]}
                            onPress={() => {
                              setPendingPantryItem(null);
                              if (isReplacing) {
                                setPendingRecipe(recipe);
                                setRecipeDropdownOpen(false);
                                setRecipeSearch('');
                              } else {
                                handlePickRecipe(recipe);
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${recipe.title}`}
                            accessibilityState={{ selected: isSelected }}
                          >
                            <Text style={[styles.dropdownItemTitle, { color: isSelected ? colors.accent : colors.textPrimary }]} numberOfLines={1}>
                              {recipe.title}
                            </Text>
                            {recipe.calories > 0 && (
                              <Text style={[styles.dropdownItemCalories, { color: colors.textSecondary }]}>
                                {recipe.calories} cal
                              </Text>
                            )}
                            {isSelected && (
                              <Ionicons name="checkmark" size={16} color={colors.accent} style={{ marginLeft: 6 }} />
                            )}
                          </TouchableOpacity>
                        );
                      }}
                    />
                  </View>
                )}
              </View>
            )}

            {/* Pantry product — a single item eaten on its own (yogurt, fruit, …) */}
            {pantryItems.length > 0 && (
              <View>
                {savedRecipes.length > 0 && (
                  <View style={[styles.dividerRow, { marginBottom: 12 }]}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerLabel}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}
                <TouchableOpacity
                  style={[
                    styles.dropdownTrigger,
                    pantryDropdownOpen && styles.dropdownTriggerOpen,
                  ]}
                  onPress={() => {
                    setPantryDropdownOpen((v) => !v);
                    setPantrySearch('');
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Pick a product from the pantry"
                  accessibilityState={{ expanded: pantryDropdownOpen }}
                >
                  <View style={styles.dropdownTriggerLeft}>
                    <Ionicons
                      name={pendingPantryItem ? 'nutrition' : 'nutrition-outline'}
                      size={15}
                      color={pendingPantryItem ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.dropdownTriggerLabel, pendingPantryItem && { color: colors.accent }]} numberOfLines={1}>
                      {pendingPantryItem ? pendingPantryItem.name : 'Pick from pantry'}
                    </Text>
                  </View>
                  <View style={styles.dropdownTriggerRight}>
                    <Text style={styles.dropdownCount}>{pantryItems.length}</Text>
                    <Ionicons
                      name={pantryDropdownOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={colors.textTertiary}
                    />
                  </View>
                </TouchableOpacity>

                {pantryDropdownOpen && (
                  <View style={[styles.dropdownPanel, { borderColor: colors.border }]}>
                    <View style={[styles.dropdownSearch, { borderBottomColor: colors.border }]}>
                      <Ionicons name="search-outline" size={14} color={colors.textTertiary} />
                      <TextInput
                        style={[styles.dropdownSearchInput, { color: colors.textPrimary }]}
                        placeholder="Search pantry…"
                        placeholderTextColor={colors.textTertiary}
                        value={pantrySearch}
                        onChangeText={setPantrySearch}
                        autoFocus
                      />
                      {pantrySearch.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setPantrySearch('')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={14} color={colors.textTertiary} />
                        </TouchableOpacity>
                      )}
                    </View>

                    <FlatList
                      data={filteredPantryItems}
                      keyExtractor={(p) => p.id}
                      style={{ maxHeight: 200 }}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      ListEmptyComponent={
                        <Text style={[styles.dropdownEmpty, { color: colors.textTertiary }]}>
                          No pantry items match "{pantrySearch}"
                        </Text>
                      }
                      renderItem={({ item, index }) => {
                        const isSelected = pendingPantryItem?.id === item.id;
                        return (
                          <TouchableOpacity
                            style={[
                              styles.dropdownItem,
                              { borderBottomColor: colors.border },
                              index === filteredPantryItems.length - 1 && { borderBottomWidth: 0 },
                              isSelected && { backgroundColor: colors.accentSoft },
                            ]}
                            onPress={() => {
                              setPendingRecipe(null);
                              setPendingPantryItem(item);
                              setPantryAmount('1');
                              setPantryCalories('');
                              setPantryDropdownOpen(false);
                              setPantrySearch('');
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${item.name}`}
                            accessibilityState={{ selected: isSelected }}
                          >
                            <Text style={[styles.dropdownItemTitle, { color: isSelected ? colors.accent : colors.textPrimary }]} numberOfLines={1}>
                              {item.name}
                            </Text>
                            <Text style={[styles.dropdownItemCalories, { color: colors.textSecondary }]}>
                              {item.quantity} {item.unit}
                            </Text>
                            {isSelected && (
                              <Ionicons name="checkmark" size={16} color={colors.accent} style={{ marginLeft: 6 }} />
                            )}
                          </TouchableOpacity>
                        );
                      }}
                    />
                  </View>
                )}

                {pendingPantryItem && !pantryDropdownOpen && (
                  <View style={styles.pantryFieldsRow}>
                    <View style={styles.pantryField}>
                      <Text style={styles.pantryFieldLabel}>Amount ({pendingPantryItem.unit || 'pcs'})</Text>
                      <TextInput
                        style={styles.pantryFieldInput}
                        value={pantryAmount}
                        onChangeText={setPantryAmount}
                        keyboardType="numeric"
                        placeholder="1"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Amount"
                      />
                    </View>
                    <View style={styles.pantryField}>
                      <Text style={styles.pantryFieldLabel}>Calories (optional)</Text>
                      <TextInput
                        style={styles.pantryFieldInput}
                        value={pantryCalories}
                        onChangeText={setPantryCalories}
                        keyboardType="numeric"
                        placeholder="—"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel="Calories"
                      />
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Add new recipe — navigates to full recipe creation */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerLabel}>or</Text>
              <View style={styles.dividerLine} />
            </View>
            <TouchableOpacity
              style={styles.newRecipeButton}
              onPress={handleAddNewRecipe}
              accessibilityRole="button"
              accessibilityLabel="Add a new recipe"
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.newRecipeButtonLabel}>Add a new recipe</Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelButton, { flex: 1 }]}
                onPress={closeModal}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonLabel}>Cancel</Text>
              </TouchableOpacity>

              {isReplacing ? (
                <TouchableOpacity
                  style={[styles.updateButton, { flex: 1 }, !canUpdate && styles.updateButtonDisabled]}
                  onPress={handleConfirmUpdate}
                  disabled={!canUpdate}
                  accessibilityRole="button"
                  accessibilityLabel="Update meal"
                >
                  <Text style={styles.updateButtonLabel}>Update</Text>
                </TouchableOpacity>
              ) : pendingPantryItem ? (
                <TouchableOpacity
                  style={[styles.updateButton, { flex: 1 }]}
                  onPress={handleAddPantryMeal}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${pendingPantryItem.name} to the meal plan`}
                >
                  <Text style={styles.updateButtonLabel}>Add</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addRecipeVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setAddRecipeVisible(false)}
      >
        <View style={styles.popupOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAddRecipeVisible(false)} />
          <View style={styles.popupDialog}>
            <AddRecipeScreen
              onClose={() => setAddRecipeVisible(false)}
              route={{ params: { fromMealPlan: true, mealSlot: selectedSlot, weekKey } }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screenRoot: { flex: 1, minHeight: 0, backgroundColor: colors.background },

  popupOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  popupDialog: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '88%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },

  headerSection: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  screenTitle: { ...type.h2, color: colors.textPrimary },

  weekNavigator: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weekArrowButton: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  todayButton: {
    height: 32, paddingHorizontal: 10, borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 2,
  },
  todayButtonLabel: { ...type.label, color: colors.accent },
  weekRangeLabel: { ...type.label, color: colors.textSecondary, marginHorizontal: 8 },

  summaryStatsRow: {
    flexDirection: 'row', paddingHorizontal: spacing.xl, gap: 10, marginBottom: spacing.md,
  },
  summaryStatCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12,
    alignItems: 'center', gap: 3, borderWidth: 1, borderColor: colors.border,
  },
  summaryStatValue: { ...type.h3, color: colors.accent },

  targetCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  targetIcon: {
    width: 34, height: 34, borderRadius: radius.full,
    backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  targetValue: { ...type.bodyMed, color: colors.textPrimary },
  targetMeta:  { ...type.caption, color: colors.textSecondary },
  summaryStatLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },

  progressTrack: {
    width: '100%', height: 3, borderRadius: 2,
    backgroundColor: colors.muted, overflow: 'hidden', marginTop: 2,
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.sage },

  mobileContent: { paddingBottom: 120 },
  dayGrid: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: 12 },
  dayCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  dayCardToday: { borderColor: colors.accent, borderWidth: 1.5 },
  dayCardPast:  { opacity: 0.72 },

  // Desktop week grid
  desktopGrid: {
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  desktopGridRow: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  desktopCornerCell: {
    width: 80, backgroundColor: colors.surfaceElevated,
    borderRightWidth: 1, borderRightColor: colors.border,
  },
  desktopDayHeaderCell: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 4,
    alignItems: 'center', gap: 2,
    backgroundColor: colors.surfaceElevated,
    borderLeftWidth: 1, borderLeftColor: colors.border,
  },
  desktopDayHeaderCellToday: { backgroundColor: colors.accentSoft },
  desktopDayHeaderCellPast:  { opacity: 0.6 },
  desktopDayProgressRow:  { flexDirection: 'row', alignItems: 'center', gap: 3 },
  desktopDayProgressText: { ...type.caption, fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
  desktopDayAbbr: {
    ...type.caption, color: colors.textSecondary,
    fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  desktopDayAbbrToday: { color: colors.accent },
  desktopDayDate:      { ...type.caption, color: colors.textTertiary },
  desktopDayCalories:  { ...type.caption, color: colors.textSecondary, fontWeight: '600' },
  desktopDayCaloriesToday: { color: colors.accent },

  desktopMealLabelCell: {
    width: 80, paddingVertical: 14, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: colors.border,
  },
  desktopMealLabel: {
    ...type.caption, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  desktopMealCell: {
    flex: 1, minHeight: 62, padding: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderLeftWidth: 1, borderLeftColor: colors.border,
  },
  desktopMealCellToday: { backgroundColor: colors.surfaceElevated },
  desktopMealName: {
    ...type.caption, fontWeight: '600', textAlign: 'center', lineHeight: 15,
  },

  dayCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  dayCardHeaderToday: { backgroundColor: colors.accentSoft },
  dayName:            { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  dayNameToday:       { color: colors.accent },
  dayDateLabel:       { ...type.caption, color: colors.textTertiary, marginTop: 1 },

  dayCardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.muted,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
  },
  dayStatusBadgeDone:   { backgroundColor: colors.sageSoft },
  dayStatusBadgeMissed: { backgroundColor: colors.dangerSoft },
  dayStatusBadgeText:   { ...type.caption, color: colors.textSecondary, fontWeight: '600' },

  calorieBadge:         { backgroundColor: colors.muted, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full },
  calorieBadgeToday:    { backgroundColor: colors.accentSoft },
  calorieBadgeText:     { ...type.caption, color: colors.textSecondary, fontWeight: '600' },
  calorieBadgeTextToday:{ color: colors.accent },
  calorieBadgeOver:     { backgroundColor: colors.warningSoft },
  calorieBadgeTextOver: { color: colors.warning },

  mealSlotsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  mealSlot: {
    width: '50%', padding: 10,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mealSlotCooked: { backgroundColor: colors.sageSoft },
  mealSlotMissed: { backgroundColor: colors.dangerSoft },
  mealTypeLabel: {
    ...type.caption, color: colors.textTertiary, fontWeight: '700',
    textTransform: 'uppercase', marginBottom: 3, letterSpacing: 0.6,
  },
  mealName:      { ...type.bodySm, fontWeight: '600' },
  mealPortion:   { ...type.caption, color: colors.textTertiary, marginTop: 1 },
  // Cooked reads as struck-through and faded; missed keeps full contrast in danger.
  mealNameCooked:{ color: colors.sage, textDecorationLine: 'line-through', opacity: 0.75 },
  mealNameMissed:{ color: colors.danger },
  mealEmptyRow:  { flexDirection: 'row', alignItems: 'center', gap: 3, opacity: 0.45 },
  mealEmptyLabel:{ ...type.caption, color: colors.textTertiary },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg, gap: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
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
  mealTypeChipRow: { flexDirection: 'row', gap: 8 },
  mealTypeChip: {
    flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5, borderColor: colors.border,
  },
  mealTypeChipLabel: { ...type.label, color: colors.textSecondary },

  sectionLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },

  newRecipeButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.accent,
  },
  newRecipeButtonLabel: { ...type.bodyMed, color: colors.accent },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerLabel:{ ...type.caption, color: colors.textTertiary },

  savedRecipeOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated, marginBottom: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  savedRecipeTitle:    { ...type.bodyMed, color: colors.textPrimary, flex: 1 },
  savedRecipeCalories: { ...type.caption, color: colors.textSecondary, marginLeft: 8 },

  // Weekly calories chart
  chartSection: {
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  chartHeading: {
    ...type.label, color: colors.textTertiary,
    textTransform: 'uppercase', marginBottom: spacing.md,
  },
  chartRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
  },
  chartCol: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  chartCalText: {
    fontSize: 9, fontWeight: '700', textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  chartBarTrack: {
    width: '100%', height: 72,
    justifyContent: 'flex-end', alignItems: 'center',
  },
  chartBar: {
    width: '65%', borderRadius: 3,
  },
  chartDayText: {
    ...type.caption, color: colors.textTertiary, fontSize: 10,
  },

  modalActions: { flexDirection: 'row', gap: 10 },

  cancelButton: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.muted,
  },
  cancelButtonLabel: { ...type.bodyMed, color: colors.textSecondary },

  updateButton: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  updateButtonDisabled: { opacity: 0.35 },
  updateButtonLabel: { ...type.bodyMed, color: '#fff' },

  generateShopButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    height: 40, borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.accent,
  },
  generateShopButtonLabel: { ...type.label, color: colors.accent },

  shopCoveredNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.sageSoft,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
    borderRadius: radius.md,
  },
  shopCoveredNoteText: { ...type.caption, color: colors.sage },

  shopIngRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  shopIngName:   { ...type.bodyMed, color: colors.textPrimary, flex: 1 },
  shopIngAmount: { ...type.caption, color: colors.textSecondary },

  // Recipe dropdown
  dropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  dropdownTriggerOpen: {
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  },
  dropdownTriggerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownTriggerLabel: { ...type.bodyMed, color: colors.textPrimary },
  dropdownTriggerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dropdownCount: { ...type.caption, color: colors.textTertiary, fontWeight: '600' },

  dropdownPanel: {
    borderWidth: 1, borderTopWidth: 0,
    borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  dropdownSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  dropdownSearchInput: {
    flex: 1, ...type.body, padding: 0,
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  dropdownItemTitle:    { ...type.bodyMed, flex: 1 },
  dropdownItemCalories: { ...type.caption, marginLeft: 8 },
  // Pantry product amount / calories fields
  pantryFieldsRow:  { flexDirection: 'row', gap: 10, marginTop: 10 },
  pantryField:      { flex: 1, gap: 4 },
  pantryFieldLabel: { ...type.caption, color: colors.textTertiary },
  pantryFieldInput: {
    height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },

  dropdownEmpty: {
    ...type.body, textAlign: 'center',
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xl,
  },
});
