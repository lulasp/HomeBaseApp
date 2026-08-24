import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  Modal, ActivityIndicator, Animated,
} from 'react-native';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { useNavScroll, useNavScrollProps, useNavCompact } from '../../context/NavScrollContext';
import { saveRecipe, deleteRecipe, getRecipe, getPantryItems, getGroceryItems, addGroceryItem } from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, useMobileNavClearance, MOBILE_NAV_COMPACT_SHIFT, SIDEBAR_WIDTH, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';

// Compact action bar: 40px pill + vertical padding + top border (see buttonCompact)
const COMPACT_ACTION_BAR_HEIGHT = 40 + spacing.sm * 2 + 1;

export default function RecipeDetailScreen({ route, navigation }) {
  const { isSearch } = route.params;
  const [recipe, setRecipe] = useState(route.params.recipe);
  const { householdId, user } = useAuth();

  // Refresh recipe from Firestore each time we return to this screen (e.g. after editing)
  useFocusEffect(
    useCallback(() => {
      if (!recipe.id || isSearch) return;
      getRecipe(householdId, recipe.id)
        .then((updated) => { if (updated) setRecipe(updated); })
        .catch(() => {});
    }, [householdId, recipe.id, isSearch]),
  );
  const { colors } = useTheme();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const contentKey = useEntranceReplay();
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();
  const navClearance = useMobileNavClearance();
  const { compactAnim } = useNavScroll();
  const navScrollProps = useNavScrollProps();
  const isOwnCustomRecipe = !isSearch && recipe.sourceType === 'custom' && recipe.createdBy === user?.uid;

  // Collapse the action bar in step with the nav: drop the labels and slide down
  // into the space the section switcher vacated.
  const navCompact = useNavCompact();

  const actionBarShift = compactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, isDesktop ? 0 : MOBILE_NAV_COMPACT_SHIFT],
    extrapolate: 'clamp',
  });
  const compactActions = navCompact && !isDesktop;

  const [groceryModal, setGroceryModal]     = useState(false);
  const [groceryToAdd, setGroceryToAdd]     = useState([]);
  const [groceryCovered, setGroceryCovered] = useState(0);
  const [groceryLoading, setGroceryLoading] = useState(false);

  const normName = (s) => (s || '').trim().toLowerCase();

  const handleAddToGrocery = async () => {
    setGroceryLoading(true);
    try {
      const [pantryItems, groceryItems] = await Promise.all([
        getPantryItems(householdId),
        getGroceryItems(householdId),
      ]);

      const toAdd = [];
      let covered = 0;
      for (const ing of recipe.ingredients) {
        if (!ing.name?.trim()) continue;
        const inPantry = pantryItems.some((p) => normName(p.name) === normName(ing.name));
        const onList   = groceryItems.some((g) => !g.checked && normName(g.name) === normName(ing.name));
        if (inPantry || onList) { covered++; } else { toAdd.push(ing); }
      }

      setGroceryToAdd(toAdd);
      setGroceryCovered(covered);
      setGroceryModal(true);
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setGroceryLoading(false);
    }
  };

  const handleConfirmGrocery = async () => {
    try {
      await Promise.all(groceryToAdd.map((ing) =>
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
        `${groceryToAdd.length} ingredient${groceryToAdd.length !== 1 ? 's' : ''} added.`,
        { type: 'success' },
      );
      setGroceryModal(false);
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const handleSave = async () => {
    await saveRecipe(householdId, recipe);
    await notify('Saved!', `"${recipe.title}" added to your recipes.`, { type: 'success' });
    navigation.goBack();
  };

  const handleDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Delete recipe',
      message: `Remove "${recipe.title}"?`,
      type: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await deleteRecipe(householdId, recipe.id);
      notify('Recipe deleted', `"${recipe.title}" has been removed.`, { type: 'info' });
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Delete failed', message: e.message, type: 'error' });
    }
  };

  return (
    <View style={{ height: windowHeight, backgroundColor: colors.background, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }}>
      <ScrollView
        key={contentKey}
        showsVerticalScrollIndicator={false}
        {...navScrollProps}
        contentContainerStyle={{
          paddingBottom: isDesktop
            ? 120
            // You only reach the end of the page scrolled down, i.e. with the nav
            // and action bar compact — pad for that, not for the expanded bar.
            : COMPACT_ACTION_BAR_HEIGHT + navClearance - MOBILE_NAV_COMPACT_SHIFT + spacing.md,
        }}
      >

        {/* Back button — first item in scroll content, always visible, no z-index issues */}
        <View style={styles.navHeader}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <Rise index={0} style={styles.heroImage}>
          {recipe.imageUrl
            ? <Image source={{ uri: recipe.imageUrl }} style={styles.heroImageFill} />
            : (
              <View style={styles.heroImagePlaceholder}>
                <Ionicons name="restaurant-outline" size={64} color={colors.textTertiary} />
              </View>
            )
          }
        </Rise>

        <View style={[styles.recipeBody, isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }]}>
          <Rise index={1}><Text style={styles.recipeTitle}>{recipe.title}</Text></Rise>

          <Rise index={2} style={styles.statsRow}>
            {[
              recipe.prepTime > 0  && { icon: 'cut-outline',         value: `${recipe.prepTime}m`,  label: 'Prep',   color: colors.accent },
              recipe.cookTime > 0  && { icon: 'flame-outline',       value: `${recipe.cookTime}m`,  label: 'Cook',   color: colors.amber  },
              recipe.servings > 0  && { icon: 'people-outline',      value: recipe.servings,         label: 'Serves', color: colors.accent },
              recipe.calories > 0  && { icon: 'stats-chart-outline', value: recipe.calories,         label: 'Cal',    color: colors.amber  },
            ].filter(Boolean).map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Ionicons name={stat.icon} size={18} color={stat.color} />
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </Rise>

          {recipe.summary ? (
            <Rise index={3} style={styles.recipeSection}>
              <Text style={styles.recipeSectionTitle}>About</Text>
              <Text style={styles.recipeSummaryText}>{recipe.summary}</Text>
            </Rise>
          ) : null}

          {recipe.ingredients?.length > 0 && (
            <Rise index={4} style={styles.recipeSection}>
              <Text style={styles.recipeSectionTitle}>Ingredients</Text>
              <View style={styles.ingredientList}>
                {recipe.ingredients.map((ingredient, index) => (
                  <View key={index} style={styles.ingredientRow}>
                    <View style={styles.ingredientBullet} />
                    <Text style={styles.ingredientText}>
                      <Text style={styles.ingredientAmount}>{ingredient.amount} {ingredient.unit} </Text>
                      {ingredient.name}
                    </Text>
                  </View>
                ))}
              </View>
            </Rise>
          )}

          {recipe.instructions?.length > 0 && (
            <Rise index={5} style={styles.recipeSection}>
              <Text style={styles.recipeSectionTitle}>Instructions</Text>
              <View style={styles.instructionList}>
                {recipe.instructions.map((step, index) => (
                  <View key={index} style={styles.instructionStep}>
                    <View style={styles.stepNumberBadge}>
                      <Text style={styles.stepNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.stepInstructionText}>{step}</Text>
                  </View>
                ))}
              </View>
            </Rise>
          )}
        </View>
      </ScrollView>

      <Animated.View
        style={[
          styles.bottomActionBar,
          // Sit above the floating mobile nav instead of behind it
          !isDesktop && { bottom: navClearance, paddingBottom: spacing.md, transform: [{ translateY: actionBarShift }] },
          compactActions && { paddingTop: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
          isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%', left: undefined, right: undefined, position: 'relative', borderTopWidth: 0, paddingBottom: spacing.xl },
        ]}
      >
        {isSearch ? (
          <TouchableOpacity
            style={[styles.saveButton, compactActions && { height: 40 }]}
            onPress={handleSave}
            accessibilityRole="button"
          >
            <Ionicons name="bookmark" size={compactActions ? 16 : 18} color="#fff" />
            <Text style={styles.saveButtonLabel}>Save to My Recipes</Text>
          </TouchableOpacity>
        ) : compactActions ? (
          // Compact: one row of icon-only pills, matching the nav dropping its labels
          <View style={styles.actionRow}>
            {recipe.ingredients?.length > 0 && (
              <TouchableOpacity
                style={[styles.addToGroceryButton, styles.buttonCompact]}
                onPress={handleAddToGrocery}
                disabled={groceryLoading}
                accessibilityRole="button"
                accessibilityLabel="Add ingredients to grocery list"
              >
                {groceryLoading
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Ionicons name="cart-outline" size={16} color={colors.accent} />
                }
              </TouchableOpacity>
            )}
            {isOwnCustomRecipe && (
              <TouchableOpacity
                style={[styles.editButton, styles.buttonCompact]}
                onPress={() => navigation.navigate('AddRecipe', { recipe })}
                accessibilityRole="button"
                accessibilityLabel="Edit recipe"
              >
                <Ionicons name="pencil-outline" size={16} color={colors.accent} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.deleteButton, styles.buttonCompact]}
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete recipe"
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {recipe.ingredients?.length > 0 && (
              <TouchableOpacity
                style={styles.addToGroceryButton}
                onPress={handleAddToGrocery}
                disabled={groceryLoading}
                accessibilityRole="button"
                accessibilityLabel="Add ingredients to grocery list"
              >
                {groceryLoading
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Ionicons name="cart-outline" size={16} color={colors.accent} />
                }
                <Text style={styles.addToGroceryButtonLabel}>Add to Grocery List</Text>
              </TouchableOpacity>
            )}
            <View style={styles.actionRow}>
              {isOwnCustomRecipe && (
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => navigation.navigate('AddRecipe', { recipe })}
                  accessibilityRole="button"
                >
                  <Ionicons name="pencil-outline" size={18} color={colors.accent} />
                  <Text style={styles.editButtonLabel}>Edit Recipe</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.deleteButton, isOwnCustomRecipe && { flex: 1 }]} onPress={handleDelete} accessibilityRole="button">
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.deleteButtonLabel}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>
      <Modal visible={groceryModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.groceryOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setGroceryModal(false)} />
          <View style={styles.grocerySheet}>
            <View style={styles.grocerySheetHandle} />
            <Text style={styles.grocerySheetTitle}>
              {groceryToAdd.length > 0
                ? `Add ${groceryToAdd.length} ingredient${groceryToAdd.length !== 1 ? 's' : ''}`
                : 'Nothing to add'}
            </Text>

            {groceryCovered > 0 && (
              <View style={styles.groceryCoveredNote}>
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.sage} />
                <Text style={styles.groceryCoveredText}>
                  {groceryCovered} already in pantry or on your list
                </Text>
              </View>
            )}

            {groceryToAdd.length > 0 ? (
              <>
                <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                  {groceryToAdd.map((ing, i) => (
                    <View key={i} style={styles.groceryIngRow}>
                      <Ionicons name="ellipse" size={6} color={colors.accent} />
                      <Text style={styles.groceryIngName} numberOfLines={1}>{ing.name}</Text>
                      {(ing.amount || ing.unit) ? (
                        <Text style={styles.groceryIngAmount}>{ing.amount} {ing.unit}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.groceryActions}>
                  <TouchableOpacity style={[styles.groceryCancelBtn, { flex: 1 }]} onPress={() => setGroceryModal(false)}>
                    <Text style={styles.groceryCancelLabel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.groceryConfirmBtn, { flex: 2 }]} onPress={handleConfirmGrocery}>
                    <Ionicons name="cart" size={16} color="#fff" />
                    <Text style={styles.groceryConfirmLabel}>Add to Grocery List</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.groceryActions}>
                <TouchableOpacity style={[styles.groceryCancelBtn, { flex: 1 }]} onPress={() => setGroceryModal(false)}>
                  <Text style={styles.groceryCancelLabel}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  navHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    padding: 8, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },

  heroImage:       { height: 280 },
  heroImageFill:   { width: '100%', height: '100%' },
  heroImagePlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
  },

  recipeBody:    { padding: spacing.xl, gap: spacing.xxl },
  recipeTitle:   { ...type.h2, color: colors.textPrimary, lineHeight: 34 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: 12, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  statValue: { ...type.h4, color: colors.textPrimary },
  statLabel: { ...type.caption, color: colors.textSecondary },

  recipeSection:      { gap: 14 },
  recipeSectionTitle: { ...type.h3, color: colors.textPrimary },
  recipeSummaryText:  { ...type.body, color: colors.textSecondary, lineHeight: 24 },

  ingredientList: { gap: 10 },
  ingredientRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  ingredientBullet: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.accent, marginTop: 8, flexShrink: 0,
  },
  ingredientText:   { flex: 1, ...type.body, color: colors.textPrimary, lineHeight: 22 },
  ingredientAmount: { fontWeight: '700', color: colors.accent },

  instructionList: { gap: 14 },
  instructionStep: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepNumberBadge: {
    width: 28, height: 28, borderRadius: radius.full,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepNumberText:       { ...type.label, color: '#fff', fontSize: 13 },
  stepInstructionText:  { flex: 1, ...type.body, color: colors.textPrimary, lineHeight: 23 },

  bottomActionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.xl, paddingBottom: 40, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  // Icon-only pill used while the nav is compact
  buttonCompact: { flex: 1, height: 40, paddingHorizontal: 0 },

  addToGroceryButton: {
    height: 52, backgroundColor: colors.accentSoft, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addToGroceryButtonLabel: { ...type.h4, color: colors.accent },

  groceryOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  grocerySheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg, gap: 14,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  grocerySheetHandle: {
    width: 36, height: 4, backgroundColor: colors.borderStrong,
    borderRadius: 2, alignSelf: 'center', marginBottom: 4,
  },
  grocerySheetTitle:  { ...type.h3, color: colors.textPrimary },
  groceryCoveredNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.sageSoft,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
    borderRadius: radius.md,
  },
  groceryCoveredText: { ...type.caption, color: colors.sage },
  groceryIngRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  groceryIngName:   { ...type.bodyMed, color: colors.textPrimary, flex: 1 },
  groceryIngAmount: { ...type.caption, color: colors.textSecondary },
  groceryActions:   { flexDirection: 'row', gap: 10 },
  groceryCancelBtn: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.muted,
  },
  groceryCancelLabel:  { ...type.bodyMed, color: colors.textSecondary },
  groceryConfirmBtn: {
    height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  groceryConfirmLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  saveButton: {
    height: 52, backgroundColor: colors.primary, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveButtonLabel: { ...type.h4, color: '#fff' },
  editButton: {
    flex: 1, height: 52, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  editButtonLabel: { ...type.h4, color: colors.accent },
  deleteButton: {
    height: 52, backgroundColor: colors.dangerSoft, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.danger,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16,
  },
  deleteButtonLabel: { ...type.h4, color: colors.danger },
});
