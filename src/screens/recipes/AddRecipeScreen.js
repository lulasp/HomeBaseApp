import React, { useState, useMemo, useEffect, memo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { saveRecipe, updateRecipe, setMealSlot, subscribePantryItems } from '../../services/firestore';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';

// ── Ingredient row with pantry autocomplete ────────────────────────────────────
const IngredientInput = memo(({ ingredient, index, pantryItems, colors, onUpdate, onRemove, showRemove }) => {
  const [focused, setFocused] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const suggestions = useMemo(() => {
    const q = ingredient.name.trim().toLowerCase();
    if (!q || !focused || ingredient.pantryItemId) return [];
    return pantryItems
      .filter((item) => item.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [ingredient.name, focused, ingredient.pantryItemId, pantryItems]);

  const selectSuggestion = (item) => {
    onUpdate(index, { name: item.name, unit: item.unit || '', pantryItemId: item.id });
    setFocused(false);
  };

  const clearPantryLink = () => {
    if (ingredient.pantryItemId) onUpdate(index, { pantryItemId: null });
  };

  return (
    <View style={styles.ingredientCard}>
      <View>
        <View style={styles.ingredientNameRow}>
          <TextInput
            style={[styles.textInput, styles.flexInput]}
            placeholder="Ingredient name"
            value={ingredient.name}
            onChangeText={(v) => {
              onUpdate(index, { name: v, pantryItemId: null });
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Ingredient name"
          />
          {ingredient.pantryItemId && (
            <TouchableOpacity
              style={styles.pantryBadge}
              onPress={clearPantryLink}
              accessibilityLabel="Linked to pantry — tap to unlink"
            >
              <Ionicons name="nutrition" size={12} color={colors.accent} />
              <Text style={styles.pantryBadgeText}>Pantry</Text>
            </TouchableOpacity>
          )}
        </View>
        {suggestions.length > 0 && (
          <View style={styles.suggestionList}>
            {suggestions.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.suggestionItem}
                onPress={() => selectSuggestion(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionName}>{item.name}</Text>
                <View style={styles.suggestionRight}>
                  {item.unit ? <Text style={styles.suggestionUnit}>{item.quantity} {item.unit}</Text> : null}
                  <Text style={styles.suggestionCategory}>{item.category}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <View style={styles.ingredientMetaRow}>
        <TextInput
          style={[styles.textInput, styles.flexInput]}
          placeholder="Amount"
          value={ingredient.amount}
          onChangeText={(v) => onUpdate(index, 'amount', v)}
          keyboardType="decimal-pad"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Amount"
        />
        <TextInput
          style={[styles.textInput, styles.flexInput]}
          placeholder="Unit"
          value={ingredient.unit}
          onChangeText={(v) => onUpdate(index, 'unit', v)}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Unit"
          editable={!ingredient.pantryItemId}
        />
        {showRemove && (
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Remove ingredient"
          >
            <Ionicons name="remove-circle" size={22} color={colors.danger} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

// ── Main screen ────────────────────────────────────────────────────────────────
export default function AddRecipeScreen({ navigation, route, onClose }) {
  const existing     = route?.params?.recipe ?? null;
  const isEditing    = !!existing;
  const fromMealPlan = route?.params?.fromMealPlan ?? false;
  const mealSlot     = route?.params?.mealSlot ?? null;
  const mealWeekKey  = route?.params?.weekKey ?? null;

  const dismiss = () => onClose ? onClose() : navigation?.goBack();

  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const contentKey = useEntranceReplay();
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();

  const [pantryItems, setPantryItems]     = useState([]);
  const [title, setTitle]                 = useState(existing?.title ?? '');
  const [servings, setServings]           = useState(existing?.servings ? String(existing.servings) : '');
  const [prepTime, setPrepTime]           = useState(existing?.prepTime ? String(existing.prepTime) : '');
  const [cookTime, setCookTime]           = useState(existing?.cookTime ? String(existing.cookTime) : '');
  const [calories, setCalories]           = useState(existing?.calories ? String(existing.calories) : '');
  const [summary, setSummary]             = useState(existing?.summary ?? '');
  const [ingredients, setIngredients]     = useState(
    existing?.ingredients?.length
      ? existing.ingredients.map(i => ({ pantryItemId: null, ...i }))
      : [{ name: '', amount: '', unit: '', pantryItemId: null }]
  );
  const [instructions, setInstructions]   = useState(
    existing?.instructions?.length ? existing.instructions : ['']
  );
  const [isSaving, setIsSaving]           = useState(false);
  const [errors, setErrors]               = useState({});

  useEffect(() => {
    if (!householdId) return;
    return subscribePantryItems(householdId, setPantryItems);
  }, [householdId]);

  const addIngredient    = () => setIngredients((prev) => [...prev, { name: '', amount: '', unit: '', pantryItemId: null }]);
  const removeIngredient = (index) => setIngredients((prev) => prev.filter((_, i) => i !== index));
  const updateIngredient = (index, fieldOrPatch, value) => {
    setIngredients((prev) => {
      const next = [...prev];
      next[index] = typeof fieldOrPatch === 'object'
        ? { ...next[index], ...fieldOrPatch }
        : { ...next[index], [fieldOrPatch]: value };
      return next;
    });
  };

  const addStep    = () => setInstructions((prev) => [...prev, '']);
  const removeStep = (index) => setInstructions((prev) => prev.filter((_, i) => i !== index));
  const updateStep = (index, value) => {
    setInstructions((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = 'Required';
    if (!servings.trim()) e.servings = 'Required';
    if (!prepTime.trim()) e.prepTime = 'Required';
    if (!cookTime.trim()) e.cookTime = 'Required';
    if (!calories.trim()) e.calories = 'Required';
    if (!summary.trim()) e.summary = 'Required';
    if (!ingredients.some((i) => i.name.trim() && i.amount.trim()))
      e.ingredients = 'Add at least one ingredient with name and amount';
    if (!instructions.some((s) => s.trim()))
      e.instructions = 'Add at least one instruction step';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const data = {
      title: title.trim(),
      servings: parseInt(servings) || 1,
      prepTime: parseInt(prepTime) || 0,
      cookTime: parseInt(cookTime) || 0,
      calories: parseInt(calories) || 0,
      summary: summary.trim(),
      ingredients: ingredients.filter((item) => item.name.trim()),
      instructions: instructions.filter((step) => step.trim()),
      imageUrl: existing?.imageUrl ?? null,
      sourceType: 'custom',
      createdBy: user.uid,
    };
    try {
      if (isEditing) {
        await updateRecipe(householdId, existing.id, data);
        notify('Recipe updated', `"${data.title}" has been saved.`, { type: 'success' });
        dismiss();
      } else {
        const docRef = await saveRecipe(householdId, data);
        if (fromMealPlan && mealSlot && mealWeekKey) {
          await setMealSlot(householdId, mealWeekKey, mealSlot.day, mealSlot.mealType, {
            name: data.title, recipeId: docRef.id, calories: data.calories || 0,
          });
          notify('Meal added', `"${data.title}" added to ${mealSlot.day} ${mealSlot.mealType}.`, { type: 'success' });
          dismiss();
        } else {
          notify('Recipe added', `"${data.title}" added to your recipes.`, { type: 'success' });
          dismiss();
        }
      }
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={onClose
        ? { flex: 1, backgroundColor: colors.background }
        : { height: windowHeight, backgroundColor: colors.background, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }
      }
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.navigationBar}>
        <TouchableOpacity
          onPress={() => dismiss()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.navigationTitle}>
          {isEditing ? 'Edit Recipe' : fromMealPlan ? 'New Recipe for Meal Plan' : 'New Recipe'}
        </Text>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
          accessibilityRole="button"
        >
          <Text style={styles.saveButtonLabel}>{isSaving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        key={contentKey}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Details ── */}
        <Rise index={0} style={styles.formSection}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View>
            <TextInput
              style={[styles.textInput, !!errors.title && styles.inputError]}
              placeholder="Recipe title *"
              value={title}
              onChangeText={(t) => { setTitle(t); if (errors.title) setErrors((e) => ({ ...e, title: null })); }}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Recipe title"
            />
            {!!errors.title && <Text style={styles.errorText}>{errors.title}</Text>}
          </View>
          <View>
            <TextInput
              style={[styles.textInput, styles.textAreaInput, !!errors.summary && styles.inputError]}
              placeholder="Brief description *"
              value={summary}
              onChangeText={(t) => { setSummary(t); if (errors.summary) setErrors((e) => ({ ...e, summary: null })); }}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              placeholderTextColor={colors.textTertiary}
            />
            {!!errors.summary && <Text style={styles.errorText}>{errors.summary}</Text>}
          </View>
          <View style={styles.statsFieldGrid}>
            {[
              ['Prep (min)', prepTime, setPrepTime, 'prepTime'],
              ['Cook (min)', cookTime, setCookTime, 'cookTime'],
              ['Servings',   servings, setServings,  'servings'],
              ['Calories',   calories, setCalories,  'calories'],
            ].map(([label, value, setter, key]) => (
              <View key={label} style={styles.statsField}>
                <Text style={styles.inputLabel}>{label} *</Text>
                <TextInput
                  style={[styles.textInput, !!errors[key] && styles.inputError]}
                  placeholder="0"
                  value={value}
                  onChangeText={(t) => { setter(t.replace(/[^0-9]/g, '')); if (errors[key]) setErrors((e) => ({ ...e, [key]: null })); }}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={label}
                />
                {!!errors[key] && <Text style={styles.errorText}>{errors[key]}</Text>}
              </View>
            ))}
          </View>
        </Rise>

        {/* ── Ingredients ── */}
        <Rise index={1} style={styles.formSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ingredients</Text>
            <TouchableOpacity
              style={styles.addRowButton}
              onPress={addIngredient}
              accessibilityRole="button"
              accessibilityLabel="Add ingredient"
            >
              <Ionicons name="add-circle" size={24} color={colors.accent} />
            </TouchableOpacity>
          </View>
          {!!errors.ingredients && <Text style={styles.errorText}>{errors.ingredients}</Text>}
          {ingredients.map((ingredient, index) => (
            <IngredientInput
              key={index}
              ingredient={ingredient}
              index={index}
              pantryItems={pantryItems}
              colors={colors}
              onUpdate={updateIngredient}
              onRemove={() => removeIngredient(index)}
              showRemove={ingredients.length > 1}
            />
          ))}
        </Rise>

        {/* ── Instructions ── */}
        <Rise index={2} style={styles.formSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Instructions</Text>
            <TouchableOpacity
              style={styles.addRowButton}
              onPress={addStep}
              accessibilityRole="button"
              accessibilityLabel="Add step"
            >
              <Ionicons name="add-circle" size={24} color={colors.accent} />
            </TouchableOpacity>
          </View>
          {!!errors.instructions && <Text style={styles.errorText}>{errors.instructions}</Text>}
          {instructions.map((step, index) => (
            <View key={index} style={styles.instructionInputRow}>
              <View style={styles.stepNumberBadge}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <TextInput
                style={[styles.textInput, styles.instructionStepInput]}
                placeholder={`Step ${index + 1}…`}
                value={step}
                onChangeText={(v) => updateStep(index, v)}
                multiline
                textAlignVertical="top"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Step ${index + 1}`}
              />
              {instructions.length > 1 && (
                <TouchableOpacity
                  onPress={() => removeStep(index)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove step"
                >
                  <Ionicons name="remove-circle" size={22} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </Rise>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  navigationBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: 60, paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navigationTitle:    { ...type.h4, color: colors.textPrimary },
  saveButton:         { backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.md },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonLabel:    { ...type.label, color: '#fff' },

  scrollContent: { padding: spacing.xl, paddingBottom: 60, gap: spacing.xxl },

  formSection:      { gap: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:     { ...type.h3, color: colors.textPrimary },
  inputLabel:       { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', marginBottom: 4 },
  addRowButton:     { padding: 2 },

  textInput: {
    height: 46, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  textAreaInput: { height: 80, paddingTop: 12 },
  // web inputs have an intrinsic width — min-width:0 lets them shrink in a row
  flexInput: { flex: 1, minWidth: 0 },

  statsFieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statsField:     { width: '47%' },

  // Ingredient card
  ingredientCard: {
    gap: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  ingredientNameRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ingredientMetaRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },

  pantryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    flexShrink: 0,
  },
  pantryBadgeText: { fontSize: 11, fontWeight: '700', color: colors.accent },

  // Autocomplete suggestions
  suggestionList: {
    marginTop: 4,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  suggestionName:     { ...type.bodyMed, color: colors.textPrimary },
  suggestionRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestionUnit:     { ...type.caption, color: colors.accent, fontWeight: '600' },
  suggestionCategory: { ...type.caption, color: colors.textTertiary },

  // Instructions
  instructionInputRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNumberBadge: {
    width: 28, height: 28, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 9,
  },
  stepNumberText:       { ...type.caption, color: '#fff', fontWeight: '700' },
  instructionStepInput: { flex: 1, minHeight: 46 },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },
});
