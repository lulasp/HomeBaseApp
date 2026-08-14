import React, { useEffect, useState, useMemo, useRef, memo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView,
  useWindowDimensions, Modal,
} from 'react-native';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScroll } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import { subscribeRecipes, saveRecipe, deleteRecipe } from '../../services/firestore';
import { searchRecipes, getRandomRecipes, spoonacularRecipeToLocal, ApiLimitError } from '../../services/spoonacular';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, Reveal, useEntranceReplay } from '../../components/Motion';
import AddRecipeScreen from './AddRecipeScreen';

// ── Filter option definitions ─────────────────────────────────────────────────
const FILTER_OPTIONS = {
  type: [
    { label: 'Breakfast',    value: 'breakfast'    },
    { label: 'Main Course',  value: 'main course'  },
    { label: 'Side Dish',    value: 'side dish'    },
    { label: 'Dessert',      value: 'dessert'      },
    { label: 'Appetizer',    value: 'appetizer'    },
    { label: 'Soup',         value: 'soup'         },
    { label: 'Salad',        value: 'salad'        },
    { label: 'Snack',        value: 'snack'        },
  ],
  diet: [
    { label: 'Vegetarian',  value: 'vegetarian'  },
    { label: 'Vegan',       value: 'vegan'       },
    { label: 'Gluten Free', value: 'gluten free' },
    { label: 'Ketogenic',   value: 'ketogenic'   },
    { label: 'Paleo',       value: 'paleo'       },
    { label: 'Whole30',     value: 'whole30'     },
  ],
  cuisine: [
    { label: 'Italian',       value: 'italian'       },
    { label: 'Mexican',       value: 'mexican'       },
    { label: 'Asian',         value: 'asian'         },
    { label: 'Indian',        value: 'indian'        },
    { label: 'Mediterranean', value: 'mediterranean' },
    { label: 'American',      value: 'american'      },
    { label: 'French',        value: 'french'        },
    { label: 'Chinese',       value: 'chinese'       },
    { label: 'Thai',          value: 'thai'          },
    { label: 'Japanese',      value: 'japanese'      },
  ],
  maxReadyTime: [
    { label: '15 min', value: 15 },
    { label: '30 min', value: 30 },
    { label: '45 min', value: 45 },
    { label: '60 min', value: 60 },
  ],
};

const EMPTY_FILTERS = { type: null, diet: null, cuisine: [], maxReadyTime: null };

// ── FilterChip ────────────────────────────────────────────────────────────────
const FilterChip = memo(({ label, active, onPress, colors }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.75}
    style={[
      chipStyles.chip,
      {
        backgroundColor: active ? colors.accentSoft : colors.muted,
        borderColor:     active ? colors.accent     : 'transparent',
      },
    ]}
  >
    <Text style={[chipStyles.label, { color: active ? colors.accent : colors.textSecondary }]}>
      {label}
    </Text>
  </TouchableOpacity>
));

const chipStyles = StyleSheet.create({
  chip:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, marginRight: 6 },
  label: { fontSize: 12, fontWeight: '600' },
});

// ── FilterPanel ───────────────────────────────────────────────────────────────
const FILTER_SECTIONS = [
  { key: 'type',         label: 'Meal Type', multi: false },
  { key: 'diet',         label: 'Diet',      multi: false },
  { key: 'cuisine',      label: 'Cuisine',   multi: true  },
  { key: 'maxReadyTime', label: 'Max Time',  multi: false },
];

const FilterPanel = memo(({ filters, onToggle, onClear, colors }) => (
  <View style={[panelStyles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={panelStyles.header}>
      <Text style={[panelStyles.headerLabel, { color: colors.textTertiary }]}>FILTERS</Text>
      <TouchableOpacity onPress={onClear} accessibilityRole="button" accessibilityLabel="Clear all filters">
        <Text style={[panelStyles.clearBtn, { color: colors.accent }]}>Clear all</Text>
      </TouchableOpacity>
    </View>

    {FILTER_SECTIONS.map(({ key, label, multi }) => (
      <View key={key} style={panelStyles.section}>
        <Text style={[panelStyles.sectionLabel, { color: colors.textTertiary }]}>{label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={panelStyles.chipRow}>
          {FILTER_OPTIONS[key].map(({ label: chipLabel, value }) => {
            const active = multi ? filters[key].includes(value) : filters[key] === value;
            return (
              <FilterChip
                key={String(value)}
                label={chipLabel}
                active={active}
                onPress={() => onToggle(key, value, multi)}
                colors={colors}
              />
            );
          })}
        </ScrollView>
      </View>
    ))}
  </View>
));

const panelStyles = StyleSheet.create({
  panel:        { marginHorizontal: spacing.xl, marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, paddingVertical: 14 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, marginBottom: 10 },
  headerLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  clearBtn:     { fontSize: 12, fontWeight: '600' },
  section:      { marginBottom: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 14, marginBottom: 6 },
  chipRow:      { paddingHorizontal: 10 },
});

// ── RecipeCard ────────────────────────────────────────────────────────────────
const RecipeCard = memo(({ recipe, onPress, onLongPress, onSave, onUnsave, isSaved, onDelete, selectionMode, selected }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.recipeCard, selected && styles.recipeCardSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.82}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityState={selectionMode ? { checked: !!selected } : undefined}
    >
      <View style={styles.recipeCardImageContainer}>
        {recipe.imageUrl
          ? <Image source={{ uri: recipe.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : (
            <View style={[StyleSheet.absoluteFill, styles.recipeCardImagePlaceholder]}>
              <Ionicons name="restaurant-outline" size={28} color={colors.textTertiary} />
            </View>
          )
        }
        <View style={styles.recipeCardGradientOverlay} />
        <View style={styles.recipeCardBottomInfo}>
          <Text style={styles.recipeCardTitle} numberOfLines={2}>{recipe.title}</Text>
          {(recipe.cookTime > 0 || recipe.calories > 0) && (
            <View style={styles.recipeCardMetaRow}>
              {recipe.cookTime > 0 && (
                <View style={styles.recipeMetaPill}>
                  <Ionicons name="time-outline" size={10} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.recipeMetaPillText}>{recipe.cookTime}m</Text>
                </View>
              )}
              {recipe.servings > 0 && (
                <View style={styles.recipeMetaPill}>
                  <Ionicons name="people-outline" size={10} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.recipeMetaPillText}>{recipe.servings}</Text>
                </View>
              )}
              {recipe.calories > 0 && (
                <View style={styles.recipeMetaPill}>
                  <Text style={styles.recipeMetaPillText}>{recipe.calories} cal</Text>
                </View>
              )}
            </View>
          )}
        </View>
        {selectionMode && (
          <View style={[styles.selectionCheck, selected && styles.selectionCheckOn]} pointerEvents="none">
            {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
          </View>
        )}
        <View style={styles.recipeCardActionButtons}>
          {!selectionMode && (onSave || isSaved) && (
            <TouchableOpacity
              style={[styles.recipeCardActionButton, isSaved && styles.recipeCardSavedButton]}
              onPress={isSaved ? onUnsave : onSave}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Remove from saved' : 'Save recipe'}
            >
              <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={14} color="#fff" />
            </TouchableOpacity>
          )}
          {!selectionMode && onDelete && (
            <TouchableOpacity
              style={[styles.recipeCardActionButton, styles.recipeCardDeleteButton]}
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete recipe"
            >
              <Ionicons name="trash-outline" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ── RecipesScreen ─────────────────────────────────────────────────────────────
export default function RecipesScreen({ navigation }) {
  const { householdId } = useAuth();
  const { colors } = useTheme();
  const { handleScroll } = useNavScroll();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const contentKey = useEntranceReplay();
  const { width } = useWindowDimensions();
  const windowHeight = useVisualViewportHeight();

  const [activeTab,      setActiveTab]      = useState('saved');
  const [savedRecipes,   setSavedRecipes]   = useState([]);
  const [searchResults,  setSearchResults]  = useState([]);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [isSearching,    setIsSearching]    = useState(false);
  const [isLoadingRandom, setIsLoadingRandom] = useState(false);
  const [isLoadingMore,  setIsLoadingMore]  = useState(false);
  const [searchOffset,   setSearchOffset]   = useState(0);
  const [searchTotal,    setSearchTotal]    = useState(null);
  const [isRandomMode,   setIsRandomMode]   = useState(true);
  const [filters,        setFilters]        = useState(EMPTY_FILTERS);
  const [showFilters,    setShowFilters]    = useState(false);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [apiLimitReached, setApiLimitReached] = useState(false);
  const [selectionMode,  setSelectionMode]  = useState(false);
  const [selectedIds,    setSelectedIds]    = useState(() => new Set());

  const columnCount           = isDesktop ? (width >= 1440 ? 4 : 3) : 2;
  const activeFilterCount     = (filters.type ? 1 : 0) + (filters.diet ? 1 : 0) + filters.cuisine.length + (filters.maxReadyTime ? 1 : 0);

  // Track which grid slots have scrolled into view so each RecipeCard animates
  // as it appears (FlatList mounts off-screen rows early, so a mount-based
  // stagger only shows for the first screenful). Reset when the list resets.
  const listKey = `${activeTab}-${columnCount}-${contentKey}`;
  const [seen, setSeen] = useState(() => ({ key: listKey, set: new Set() }));
  if (seen.key !== listKey) setSeen({ key: listKey, set: new Set() });
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    setSeen((prev) => {
      let added = false;
      const set = new Set(prev.set);
      viewableItems.forEach((vi) => {
        if (vi.index != null && !set.has(vi.index)) { set.add(vi.index); added = true; }
      });
      return added ? { key: prev.key, set } : prev;
    });
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 15 }).current;
  const savedSpoonacularIds   = useMemo(
    () => new Set(savedRecipes.map(r => r.spoonacularId).filter(Boolean)),
    [savedRecipes],
  );

  const PAGE_SIZE = 12;

  useEffect(() => {
    if (!householdId) return;
    return subscribeRecipes(householdId, setSavedRecipes);
  }, [householdId]);

  useEffect(() => {
    if (activeTab === 'search' && searchResults.length === 0 && !isSearching) loadRandomRecipes();
  }, [activeTab]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadRandomRecipes = async (append = false) => {
    if (append) setIsLoadingMore(true);
    else        setIsLoadingRandom(true);
    try {
      const data = await getRandomRecipes(PAGE_SIZE);
      const recipes = (data.recipes || []).map(spoonacularRecipeToLocal);
      setSearchResults(prev => append ? [...prev, ...recipes] : recipes);
      setIsRandomMode(true);
      setSearchTotal(null);
    } catch (e) {
      if (e instanceof ApiLimitError) { setApiLimitReached(true); }
      else if (!append) setSearchResults([]);
    } finally {
      setIsLoadingRandom(false);
      setIsLoadingMore(false);
    }
  };

  // filtersOverride lets callers pass the newest filter state before setState has flushed
  const executeSearch = async (offset = 0, append = false, filtersOverride = null) => {
    const f = filtersOverride ?? filters;
    const hasQuery   = searchQuery.trim().length > 0;
    const hasFilters = f.type || f.diet || f.cuisine.length > 0 || f.maxReadyTime;

    if (!hasQuery && !hasFilters) {
      if (!append) loadRandomRecipes();
      return;
    }

    if (append) setIsLoadingMore(true);
    else {
      setIsSearching(true);
      if (offset === 0) { setSearchOffset(0); setSearchTotal(null); }
    }

    const params = { number: PAGE_SIZE, offset };
    if (f.type)               params.type         = f.type;
    if (f.diet)               params.diet         = f.diet;
    if (f.cuisine.length > 0) params.cuisine      = f.cuisine.join(',');
    if (f.maxReadyTime)       params.maxReadyTime = f.maxReadyTime;

    try {
      const data = await searchRecipes(searchQuery, params);
      const recipes = (data.results || []).map(spoonacularRecipeToLocal);
      setSearchResults(prev => append ? [...prev, ...recipes] : recipes);
      setSearchOffset(offset);
      setSearchTotal(data.totalResults ?? null);
      setIsRandomMode(false);
    } catch (e) {
      if (e instanceof ApiLimitError) { setApiLimitReached(true); }
      else if (!append) showAlert({ title: 'Search failed', message: 'Check your Spoonacular API key', type: 'error' });
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  const handleSearch = () => executeSearch(0, false);

  const handleLoadMore = () => {
    if (activeTab !== 'search' || isLoadingMore || isSearching || isLoadingRandom || apiLimitReached) return;
    if (isRandomMode) { loadRandomRecipes(true); return; }
    const nextOffset = searchOffset + PAGE_SIZE;
    if (searchTotal !== null && nextOffset >= searchTotal) return;
    executeSearch(nextOffset, true);
  };

  // ── Filter helpers ──────────────────────────────────────────────────────────

  const toggleFilter = (group, value, multi) => {
    const next = { ...filters };
    if (multi) {
      next[group] = next[group].includes(value)
        ? next[group].filter(v => v !== value)
        : [...next[group], value];
    } else {
      next[group] = next[group] === value ? null : value;
    }
    setFilters(next);
    executeSearch(0, false, next);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    executeSearch(0, false, EMPTY_FILTERS);
  };

  // ── Save / Delete ───────────────────────────────────────────────────────────

  const handleSaveRecipe = async (recipe) => {
    await saveRecipe(householdId, recipe);
    notify('Saved', `"${recipe.title}" added to your recipes.`, { type: 'success' });
  };

  const handleUnsaveRecipe = async (recipe) => {
    const saved = savedRecipes.find(r => r.spoonacularId === recipe.spoonacularId);
    if (!saved) return;
    try {
      await deleteRecipe(householdId, saved.id);
      notify('Removed', `"${recipe.title}" removed from your recipes.`, { type: 'info' });
    } catch (e) {
      showAlert({ title: 'Remove failed', message: e.message, type: 'error' });
    }
  };

  const handleDeleteRecipe = async (recipe) => {
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
    } catch (e) {
      showAlert({ title: 'Delete failed', message: e.message, type: 'error' });
    }
  };

  // ── Multi-select ────────────────────────────────────────────────────────────

  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const startSelection = (id) => {
    setSelectionMode(true);
    setSelectedIds(id ? new Set([id]) : new Set());
  };

  const toggleSelected = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Drop ids for recipes deleted elsewhere (another member, another device)
  useEffect(() => {
    if (!selectionMode) return;
    if (savedRecipes.length === 0) { exitSelection(); return; }
    setSelectedIds((prev) => {
      const live = new Set(savedRecipes.map(r => r.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [savedRecipes, selectionMode]);

  const handleDeleteSelected = async () => {
    const targets = savedRecipes.filter(r => selectedIds.has(r.id));
    if (targets.length === 0) return;
    const confirmed = await showConfirm({
      title: `Delete ${targets.length} recipe${targets.length > 1 ? 's' : ''}`,
      message: targets.length === 1
        ? `Remove "${targets[0].title}"?`
        : `Remove these ${targets.length} recipes? This can't be undone.`,
      type: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const results = await Promise.allSettled(targets.map(r => deleteRecipe(householdId, r.id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    exitSelection();
    if (failed) {
      showAlert({
        title: 'Delete failed',
        message: `${failed} of ${targets.length} recipes could not be deleted.`,
        type: 'error',
      });
    } else {
      notify('Recipes deleted', `${targets.length} recipe${targets.length > 1 ? 's' : ''} removed.`, { type: 'info' });
    }
  };

  // ── Header ──────────────────────────────────────────────────────────────────

  const listHeader = (
    <View>
      {selectionMode ? (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={exitSelection} accessibilityRole="button">
            <Text style={styles.selectionCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>
            {selectedIds.size} selected
          </Text>
          <TouchableOpacity
            style={[styles.selectionDeleteButton, selectedIds.size === 0 && styles.selectionDeleteButtonDisabled]}
            onPress={handleDeleteSelected}
            disabled={selectedIds.size === 0}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${selectedIds.size} selected recipes`}
          >
            <Ionicons name="trash-outline" size={15} color="#fff" />
            <Text style={styles.selectionDeleteLabel}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <Rise index={0}>
      <View style={styles.headerSection}>
        <Text style={styles.screenTitle}>Recipes</Text>
        <View style={styles.headerActions}>
          {activeTab === 'saved' && savedRecipes.length > 0 && (
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => startSelection(null)}
              accessibilityRole="button"
              accessibilityLabel="Select recipes"
            >
              <Text style={styles.selectButtonLabel}>Select</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.addRecipeButton} onPress={() => setShowAddModal(true)} accessibilityRole="button">
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addRecipeButtonLabel}>New</Text>
          </TouchableOpacity>
        </View>
      </View>
      </Rise>
      )}

      {!selectionMode && (
      <View style={styles.tabRow}>
        {[
          ['saved',  'bookmark-outline', 'Saved'   ],
          ['search', 'search-outline',   'Discover'],
        ].map(([value, icon, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.tabButton, activeTab === value && styles.tabButtonActive]}
            onPress={() => setActiveTab(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === value }}
          >
            <Ionicons name={icon} size={14} color={activeTab === value ? colors.accent : colors.textTertiary} />
            <Text style={[styles.tabButtonLabel, activeTab === value && styles.tabButtonLabelActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      )}

      {activeTab === 'search' && (
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={17} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes…"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search recipes"
            />
          </View>
          <TouchableOpacity
            style={[styles.filterToggleButton, showFilters && styles.filterToggleButtonActive]}
            onPress={() => setShowFilters(v => !v)}
            accessibilityRole="button"
            accessibilityLabel="Toggle filters"
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={showFilters || activeFilterCount > 0 ? colors.accent : colors.textSecondary}
            />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.searchSubmitButton} onPress={handleSearch} disabled={isSearching} accessibilityRole="button">
            {isSearching
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="arrow-forward" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'search' && showFilters && (
        <FilterPanel
          filters={filters}
          onToggle={toggleFilter}
          onClear={clearFilters}
          colors={colors}
        />
      )}

      {activeTab === 'search' && apiLimitReached && (
        <View style={styles.limitBanner}>
          <Ionicons name="warning-outline" size={18} color={colors.amber} />
          <Text style={styles.limitBannerText}>
            Daily API limit reached. New recipes will load again tomorrow.
          </Text>
        </View>
      )}

      {activeTab === 'search' && isLoadingRandom && !apiLimitReached && (
        <ActivityIndicator style={{ marginTop: 60, marginBottom: 20 }} color={colors.accent} />
      )}
    </View>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screenRoot, { marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }]}>
      <View style={[styles.contentWrapper, isDesktop && styles.contentWrapperDesktop]}>
        <FlatList
          key={listKey}
          style={{ height: windowHeight }}
          data={activeTab === 'saved' ? savedRecipes : searchResults}
          keyExtractor={(_, i) => String(i)}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.recipeGrid}
          numColumns={columnCount}
          columnWrapperStyle={columnCount > 1 ? { gap: 12 } : undefined}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={listHeader}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            activeTab === 'search' && isLoadingMore
              ? <ActivityIndicator style={{ marginTop: 16, marginBottom: 8 }} color={colors.accent} />
              : null
          }
          ListEmptyComponent={
            !isLoadingRandom ? (
              <View style={styles.emptyStateContainer}>
                <View style={styles.emptyStateIcon}>
                  <Ionicons name={activeTab === 'saved' ? 'book-outline' : 'restaurant-outline'} size={36} color={colors.textTertiary} />
                </View>
                <Text style={styles.emptyStateTitle}>
                  {activeTab === 'saved' ? 'No saved recipes' : 'Discover recipes above'}
                </Text>
                {activeTab === 'saved' && <Text style={styles.emptyStateSubtitle}>Save from search or add your own</Text>}
              </View>
            ) : null
          }
          renderItem={({ item: recipe, index }) => {
            const isSaved = activeTab === 'search'
              && recipe.spoonacularId != null
              && savedSpoonacularIds.has(recipe.spoonacularId);
            const selectable = activeTab === 'saved' && !!recipe.id;
            return (
              <Reveal visible={seen.set.has(index)} delay={(index % columnCount) * 60} style={{ flex: 1 }}>
                <RecipeCard
                  recipe={recipe}
                  onPress={() => (selectionMode && selectable)
                    ? toggleSelected(recipe.id)
                    : navigation.navigate('RecipeDetail', { recipe, isSearch: activeTab === 'search' })}
                  onLongPress={selectable && !selectionMode ? () => startSelection(recipe.id) : null}
                  selectionMode={selectionMode && selectable}
                  selected={selectedIds.has(recipe.id)}
                  onSave={activeTab === 'search' && !isSaved ? () => handleSaveRecipe(recipe) : null}
                  onUnsave={isSaved ? () => handleUnsaveRecipe(recipe) : null}
                  isSaved={isSaved}
                  onDelete={activeTab === 'saved' ? () => handleDeleteRecipe(recipe) : null}
                />
              </Reveal>
            );
          }}
        />
      </View>

      <Modal
        visible={showAddModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.popupOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAddModal(false)} />
          <View style={styles.popupDialog}>
            <AddRecipeScreen onClose={() => setShowAddModal(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screenRoot:             { flex: 1, backgroundColor: colors.background },
  contentWrapper:         { flex: 1 },
  contentWrapperDesktop:  { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  limitBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: 12,
    backgroundColor: colors.amberSoft,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.amber,
  },
  limitBannerText: { flex: 1, ...type.body, color: colors.amber, fontSize: 13 },

  popupOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  popupDialog: {
    width: '100%', maxWidth: 640, maxHeight: '88%',
    borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.background,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 }, elevation: 24,
  },

  headerSection: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg,
  },
  screenTitle:          { ...type.h2, color: colors.textPrimary },
  headerActions:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectButton: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  selectButtonLabel:    { ...type.label, color: colors.textSecondary, fontWeight: '700' },

  selectionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg,
  },
  selectionCancel: { ...type.label, color: colors.accent, fontWeight: '700' },
  selectionCount:  { ...type.label, color: colors.textSecondary },
  selectionDeleteButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md,
  },
  selectionDeleteButtonDisabled: { opacity: 0.4 },
  selectionDeleteLabel: { ...type.label, color: '#fff', fontWeight: '700' },

  addRecipeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md,
  },
  addRecipeButtonLabel: { ...type.label, color: '#fff', fontWeight: '700' },

  tabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: 4, gap: 4,
  },
  tabButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: radius.sm,
  },
  tabButtonActive:      { backgroundColor: colors.surfaceElevated },
  tabButtonLabel:       { ...type.label, color: colors.textTertiary },
  tabButtonLabelActive: { color: colors.accent },

  searchRow: {
    flexDirection: 'row', paddingHorizontal: spacing.xl, gap: 8, marginBottom: spacing.md,
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, height: 46,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput:        { flex: 1, ...type.body, color: colors.textPrimary },
  filterToggleButton: {
    width: 46, height: 46, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  filterToggleButtonActive: {
    borderColor: colors.accent, backgroundColor: colors.accentSoft,
  },
  filterBadge: {
    position: 'absolute', top: 6, right: 6,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText:    { fontSize: 9, fontWeight: '800', color: '#fff' },
  searchSubmitButton: {
    width: 46, height: 46, borderRadius: radius.md,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },

  recipeGrid: { paddingHorizontal: spacing.xl, paddingBottom: 160 },

  emptyStateContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyStateIcon: {
    width: 72, height: 72, borderRadius: radius.xl,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyStateTitle:    { ...type.h4, color: colors.textPrimary },
  emptyStateSubtitle: { ...type.body, color: colors.textSecondary },

  recipeCard: {
    flex: 1, borderRadius: radius.xl, marginBottom: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  // borderWidth stays 1 so selecting doesn't shift the grid
  recipeCardSelected:        { borderColor: colors.accent },
  recipeCardImageContainer:  { height: 172, position: 'relative' },
  selectionCheck: {
    position: 'absolute', top: 8, left: 8,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)',
  },
  selectionCheckOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  recipeCardImagePlaceholder: {
    backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  recipeCardGradientOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: '75%', backgroundColor: 'rgba(10,8,5,0.72)',
  },
  recipeCardBottomInfo: {
    position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10, gap: 5,
  },
  recipeCardTitle:   { fontSize: 12, fontWeight: '700', color: '#F5EDD8', lineHeight: 17 },
  recipeCardMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  recipeMetaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  recipeMetaPillText:      { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  recipeCardActionButtons: { position: 'absolute', top: 8, right: 8, gap: 6 },
  recipeCardActionButton:  { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 7 },
  recipeCardSavedButton:   { backgroundColor: 'rgba(14,165,233,0.75)' },
  recipeCardDeleteButton:  { backgroundColor: 'rgba(232,92,74,0.8)' },
});
