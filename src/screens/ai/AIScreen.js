import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, ScrollView, KeyboardAvoidingView, Platform,
  SafeAreaView, ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAuth } from '../../context/AuthContext';
import { useHousehold } from '../../context/HouseholdContext';
import { useAlert } from '../../context/AlertContext';
import { subscribePantryItems, saveRecipe, getHouseholdWithPrivate } from '../../services/firestore';
import { sendChatMessage, suggestRecipes } from '../../services/openrouter';
import { DEFAULT_AI_MODEL } from '../../utils/aiModels';
import { useNotification } from '../../context/NotificationContext';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';

// ─────────────────────────────────────────────────────────────────────────────
// Chat tab
// ─────────────────────────────────────────────────────────────────────────────

function ChatTab({ colors, styles, apiKey, aiModel }) {
  const [history, setHistory]   = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const { showAlert }           = useAlert();
  const listRef                 = useRef(null);
  const navScrollProps          = useNavScrollProps();

  const scrollToBottom = () => listRef.current?.scrollToEnd({ animated: true });

  useEffect(() => { scrollToBottom(); }, [history]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!apiKey) {
      showAlert({ title: 'AI not configured', message: 'Add an OpenRouter API key in Household settings to use the assistant.', type: 'info' });
      return;
    }

    const userMsg = { role: 'user', text };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const reply = await sendChatMessage(apiKey, history, text, aiModel);
      setHistory([...nextHistory, { role: 'model', text: reply }]);
    } catch (err) {
      showAlert({
        title: 'AI Error',
        message: err.message || 'Something went wrong. Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, history, showAlert, apiKey, aiModel]);

  const renderMessage = ({ item }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="sparkles" size={13} color={colors.accent} />
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser
            ? [styles.bubbleUser, { backgroundColor: colors.accent }]
            : [styles.bubbleAI, { backgroundColor: colors.surface, borderColor: colors.border }],
        ]}>
          <Text style={[styles.bubbleText, { color: isUser ? '#fff' : colors.textPrimary }]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {history.length === 0 ? (
        <View style={styles.emptyChat}>
          <View style={[styles.emptyChatIcon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="sparkles" size={28} color={colors.accent} />
          </View>
          <Text style={[styles.emptyChatTitle, { color: colors.textPrimary }]}>
            Ask me anything
          </Text>
          <Text style={[styles.emptyChatSubtitle, { color: colors.textSecondary }]}>
            Recipes, meal planning, grocery tips, home tasks — I'm here to help.
          </Text>
          <View style={styles.suggestionChips}>
            {['What can I cook tonight?', 'Help me plan this week\'s meals', 'Give me a quick pasta recipe'].map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.suggestionChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => { setInput(s); }}
              >
                <Text style={[styles.suggestionChipText, { color: colors.textSecondary }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={history}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToBottom}
          {...navScrollProps}
        />
      )}

      {loading && (
        <View style={[styles.typingIndicator, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.typingText, { color: colors.textTertiary }]}>Thinking…</Text>
        </View>
      )}

      <View style={[styles.inputBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.chatInput, { color: colors.textPrimary }]}
          placeholder="Message AI…"
          placeholderTextColor={colors.textTertiary}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          multiline
          maxLength={2000}
          returnKeyType="send"
          blurOnSubmit
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.accent : colors.muted }]}
          onPress={handleSend}
          disabled={!input.trim() || loading}
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={18} color={input.trim() ? '#fff' : colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function parsePrepMinutes(prepTime) {
  if (!prepTime) return 0;
  const hours   = prepTime.match(/(\d+)\s*h/i)?.[1];
  const minutes = prepTime.match(/(\d+)\s*m/i)?.[1];
  return (parseInt(hours || 0) * 60) + parseInt(minutes || 0);
}

function aiRecipeToAppRecipe(recipe, userId) {
  return {
    title:        recipe.name,
    summary:      recipe.description,
    ingredients:  [
      ...(recipe.ingredients_available ?? []),
      ...(recipe.ingredients_missing   ?? []),
    ].map((name) => ({ name, amount: '', unit: '', pantryItemId: null })),
    instructions: recipe.steps ?? [],
    prepTime:     parsePrepMinutes(recipe.prep_time),
    cookTime:     0,
    servings:     2,
    calories:     0,
    imageUrl:     null,
    sourceType:   'custom',
    createdBy:    userId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe Suggester tab
// ─────────────────────────────────────────────────────────────────────────────

function RecipeCard({ recipe, colors, styles, householdId, userId }) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saving, setSaving]     = useState(false);
  const { showAlert }           = useAlert();
  const { notify }              = useNotification();

  const handleSave = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      await saveRecipe(householdId, aiRecipeToAppRecipe(recipe, userId));
      setSaved(true);
      notify('Recipe saved', `"${recipe.name}" added to your recipes.`, { type: 'success' });
    } catch (err) {
      showAlert({ title: 'Save failed', message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.recipeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.75}>
        <View style={styles.recipeCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.recipeName, { color: colors.textPrimary }]}>{recipe.name}</Text>
            <Text style={[styles.recipeDesc, { color: colors.textSecondary }]} numberOfLines={expanded ? undefined : 2}>
              {recipe.description}
            </Text>
          </View>
          <View style={styles.recipeCardMeta}>
            <View style={[styles.prepTimePill, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="time-outline" size={11} color={colors.accent} />
              <Text style={[styles.prepTimeText, { color: colors.accent }]}>{recipe.prep_time}</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.saveRecipeBtn,
                { backgroundColor: saved ? colors.sageSoft : colors.surface, borderColor: saved ? colors.sage : colors.border },
              ]}
              onPress={handleSave}
              disabled={saved || saving}
              accessibilityLabel={saved ? 'Recipe saved' : 'Save recipe'}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.sage} />
                : <Ionicons name={saved ? 'checkmark' : 'bookmark-outline'} size={15} color={saved ? colors.sage : colors.textSecondary} />
              }
              <Text style={[styles.saveRecipeBtnText, { color: saved ? colors.sage : colors.textSecondary }]}>
                {saved ? 'Saved' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.ingredientTags}>
          {recipe.ingredients_available.slice(0, 4).map((ing) => (
            <View key={ing} style={[styles.tag, { backgroundColor: colors.sageSoft }]}>
              <Ionicons name="checkmark" size={10} color={colors.sage} />
              <Text style={[styles.tagText, { color: colors.sage }]}>{ing}</Text>
            </View>
          ))}
          {recipe.ingredients_missing.length > 0 && recipe.ingredients_missing.slice(0, 3).map((ing) => (
            <View key={ing} style={[styles.tag, { backgroundColor: colors.amberSoft }]}>
              <Ionicons name="add" size={10} color={colors.amber} />
              <Text style={[styles.tagText, { color: colors.amber }]}>{ing}</Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.stepsSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.stepsLabel, { color: colors.textTertiary }]}>STEPS</Text>
          {recipe.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepNum, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.stepNumText, { color: colors.accent }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: colors.textPrimary }]}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.expandToggle}>
        <Text style={[styles.expandToggleText, { color: colors.accent }]}>
          {expanded ? 'Show less' : 'View steps'}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );
}

function RecipeSuggesterTab({ colors, styles, apiKey, aiModel }) {
  const { householdId, user } = useAuth();
  const { showAlert }         = useAlert();

  const [items, setItems]         = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading]     = useState(false);
  const [recipes, setRecipes]     = useState(null);
  const navScrollProps            = useNavScrollProps();
  const [pantryItems, setPantryItems] = useState([]);

  useEffect(() => {
    if (!householdId) return;
    return subscribePantryItems(householdId, setPantryItems);
  }, [householdId]);

  const addItem = () => {
    const name = inputText.trim();
    if (!name) return;
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      setInputText('');
      return;
    }
    setItems((prev) => [...prev, { name }]);
    setInputText('');
  };

  const removeItem = (name) => setItems((prev) => prev.filter((i) => i.name !== name));

  const loadFromPantry = () => {
    if (!pantryItems.length) {
      showAlert({ title: 'Empty pantry', message: 'Add items to your pantry first.', type: 'info' });
      return;
    }
    setItems(pantryItems.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })));
  };

  const handleSuggest = async () => {
    if (!items.length) {
      showAlert({ title: 'No items', message: 'Add at least one ingredient first.', type: 'warning' });
      return;
    }
    if (!apiKey) {
      showAlert({ title: 'AI not configured', message: 'Add an OpenRouter API key in Household settings to use the assistant.', type: 'info' });
      return;
    }
    setLoading(true);
    setRecipes(null);
    try {
      const data = await suggestRecipes(apiKey, items, aiModel);
      setRecipes(data.recipes ?? []);
    } catch (err) {
      showAlert({
        title: 'AI Error',
        message: err.message || 'Could not get recipe suggestions. Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.suggesterContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...navScrollProps}
    >
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>What's in your kitchen?</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
        Add ingredients and I'll suggest recipes you can make.
      </Text>

      {/* Input row */}
      <View style={[styles.itemInputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.itemInput, { color: colors.textPrimary }]}
          placeholder="Add ingredient…"
          placeholderTextColor={colors.textTertiary}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addIngBtn, { backgroundColor: colors.accent }]}
          onPress={addItem}
          accessibilityLabel="Add ingredient"
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Use pantry shortcut */}
      <TouchableOpacity
        style={[styles.pantryShortcut, { backgroundColor: colors.sageSoft, borderColor: colors.sage }]}
        onPress={loadFromPantry}
      >
        <Ionicons name="nutrition-outline" size={15} color={colors.sage} />
        <Text style={[styles.pantryShortcutText, { color: colors.sage }]}>
          Load from my pantry ({pantryItems.length} items)
        </Text>
      </TouchableOpacity>

      {/* Item chips */}
      {items.length > 0 && (
        <View style={styles.itemChips}>
          {items.map((item) => (
            <View key={item.name} style={[styles.itemChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.itemChipText, { color: colors.textPrimary }]}>{item.name}</Text>
              <TouchableOpacity onPress={() => removeItem(item.name)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Suggest button */}
      <TouchableOpacity
        style={[
          styles.suggestBtn,
          { backgroundColor: items.length ? colors.accent : colors.muted },
        ]}
        onPress={handleSuggest}
        disabled={!items.length || loading}
        accessibilityLabel="Get recipe suggestions"
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="sparkles" size={16} color={items.length ? '#fff' : colors.textTertiary} />
            <Text style={[styles.suggestBtnText, { color: items.length ? '#fff' : colors.textTertiary }]}>
              Suggest Recipes
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Results */}
      {loading && (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Finding recipes…</Text>
        </View>
      )}

      {recipes && recipes.length === 0 && (
        <Text style={[styles.noResults, { color: colors.textTertiary }]}>
          No recipes found. Try adding more ingredients.
        </Text>
      )}

      {recipes && recipes.map((r, i) => (
        <RecipeCard key={i} recipe={r} colors={colors} styles={styles} householdId={householdId} userId={user?.uid} />
      ))}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'chat',    label: 'Chat',           icon: 'chatbubble-ellipses-outline' },
  { key: 'recipes', label: 'Recipe Ideas',   icon: 'restaurant-outline'           },
];

export default function AIScreen() {
  const { colors }      = useTheme();
  const { householdId } = useAuth();
  const { animationsEnabled } = useHousehold();
  const isDesktop       = useIsDesktop();
  const styles          = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab]   = useState('chat');
  const [apiKey, setApiKey] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const fadeAnim        = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animationsEnabled) { fadeAnim.setValue(1); return; }
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [animationsEnabled]);

  useEffect(() => {
    if (!householdId) return;
    getHouseholdWithPrivate(householdId).then((hh) => {
      setApiKey(hh?.openRouterApiKey ?? '');
      setAiModel(hh?.aiModel ?? DEFAULT_AI_MODEL);
    });
  }, [householdId]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Animated.View style={[styles.inner, isDesktop && styles.innerDesktop, { opacity: fadeAnim }]}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerIcon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="sparkles" size={16} color={colors.accent} />
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>AI Assistant</Text>
              <Text style={[styles.headerSubtitle, { color: colors.textTertiary }]}>Powered by OpenRouter</Text>
            </View>
          </View>
        </View>

        {/* Tab switcher */}
        <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && { backgroundColor: colors.accent }]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
            >
              <Ionicons
                name={t.icon}
                size={14}
                color={tab === t.key ? '#fff' : colors.textTertiary}
              />
              <Text style={[styles.tabBtnLabel, { color: tab === t.key ? '#fff' : colors.textTertiary }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        <View style={{ flex: 1 }}>
          {tab === 'chat'
            ? <ChatTab colors={colors} styles={styles} apiKey={apiKey} aiModel={aiModel} />
            : <RecipeSuggesterTab colors={colors} styles={styles} apiKey={apiKey} aiModel={aiModel} />
          }
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const makeStyles = (colors) => StyleSheet.create({
  root:         { flex: 1 },
  inner:        { flex: 1 },
  innerDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md,
  },
  headerLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle:    { ...type.h4, color: colors.textPrimary },
  headerSubtitle: { ...type.caption, color: colors.textTertiary, marginTop: 1 },

  // Tab bar
  tabBar: {
    flexDirection: 'row', marginHorizontal: spacing.xl, marginBottom: spacing.md,
    borderRadius: radius.md, borderWidth: 1,
    padding: 4, gap: 4,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: radius.sm - 2,
  },
  tabBtnLabel: { ...type.label, fontWeight: '700' },

  // ── Chat ────────────────────────────────────────────────────────────────────
  chatList:    { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  msgRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser:  { flexDirection: 'row-reverse' },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  bubble:     { maxWidth: '80%', borderRadius: radius.lg, padding: spacing.md },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAI:   { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { ...type.body },

  emptyChat: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xxl, gap: spacing.md,
  },
  emptyChatIcon: {
    width: 60, height: 60, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyChatTitle:    { ...type.h3, color: colors.textPrimary, textAlign: 'center' },
  emptyChatSubtitle: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  suggestionChips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 },
  suggestionChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.full, borderWidth: 1,
  },
  suggestionChipText: { ...type.caption, fontWeight: '600' },

  typingIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.xl, marginBottom: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  typingText: { ...type.caption },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    marginHorizontal: spacing.xl, marginBottom: spacing.md, marginTop: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.xl, borderWidth: 1,
  },
  chatInput: { flex: 1, ...type.body, maxHeight: 120, paddingTop: 6 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  // ── Recipe Suggester ────────────────────────────────────────────────────────
  suggesterContent: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.md,
  },
  sectionTitle:    { ...type.h3, color: colors.textPrimary },
  sectionSubtitle: { ...type.body, color: colors.textSecondary, marginTop: -4 },

  itemInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: radius.md, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  itemInput:    { flex: 1, ...type.body, height: 40, color: colors.textPrimary },
  addIngBtn: {
    width: 36, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  pantryShortcut: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1,
  },
  pantryShortcutText: { ...type.label, fontWeight: '700' },

  itemChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1,
  },
  itemChipText: { ...type.label, fontWeight: '600' },

  suggestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: radius.md,
  },
  suggestBtnText: { ...type.bodyMed, fontWeight: '700' },

  loadingState: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
  loadingText:  { ...type.body },

  noResults: { ...type.body, textAlign: 'center', paddingVertical: spacing.xl },

  // Recipe card
  recipeCard: {
    borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden',
  },
  recipeCardHeader: {
    flexDirection: 'row', gap: 12, padding: spacing.lg,
  },
  recipeCardMeta: { alignItems: 'flex-end', gap: 8, flexShrink: 0 },
  saveRecipeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1,
  },
  saveRecipeBtnText: { ...type.caption, fontWeight: '700' },
  recipeName:  { ...type.h4, color: colors.textPrimary, marginBottom: 4 },
  recipeDesc:  { ...type.body, color: colors.textSecondary },
  prepTimePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.full, alignSelf: 'flex-start', flexShrink: 0,
  },
  prepTimeText: { ...type.caption, fontWeight: '700' },

  ingredientTags: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
  },
  tagText: { ...type.caption, fontWeight: '700' },

  stepsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md,
  },
  stepsLabel:   { ...type.label, color: colors.textTertiary, marginBottom: 4 },
  stepRow:      { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  stepNumText:  { ...type.caption, fontWeight: '800' },
  stepText:     { ...type.body, flex: 1, color: colors.textPrimary },

  expandToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  expandToggleText: { ...type.caption, fontWeight: '700' },
});
