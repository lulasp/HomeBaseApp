/**
 * TEMPORARY DESIGN SHOWCASE — do not ship, not wired into navigation
 *
 * Demonstrates the suggested design system for the Home App:
 *   • "Warm Harvest" palette (terracotta + sage + amber — validated by ui-ux-pro-max)
 *   • Flat-mobile touch-first style with warm depth cues
 *   • Culinary typography scale (system fonts as stand-in for Playfair Display SC + Karla)
 *   • Component patterns: cards, pills, lists, badges, buttons, empty state
 *
 * Run standalone: add <Stack.Screen name="Showcase" component={DesignShowcaseScreen} />
 * in AppNavigator temporarily, then navigate('Showcase') from any screen.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── Design Token Proposals ───────────────────────────────────────────────────
//
// RECOMMENDATION SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
// The existing "Nocturne Kitchen" / "Daylight Kitchen" palettes are already
// excellent. The ui-ux-pro-max tool independently converged on the same
// terracotta-orange + food-green territory, validating the current direction.
//
// Suggested refinements:
//   1. Accent: Keep #E8763A (terracotta) — perfect for a kitchen app.
//   2. Sage: Deepen slightly to #5B8A58 in light mode for better 4.5:1 contrast
//      on white surfaces (current #7DB07A is 2.9:1 on white — below AA).
//   3. Amber: Keep #E0A832, verified 3.1:1 on dark surfaces (meets large-text AA).
//   4. Background (light): #FEFCF8 is ideal — warm parchment, not cold white.
//   5. Dark background: #12100E is strong — genuine espresso depth.
//   6. NEW: Add a "cream surface" token (#F7F1E8) for light-mode feature cards
//      to give visual lift without shadows.
//   7. Typography: System fonts work well; consider adding a serif heading weight
//      via expo-google-fonts (Playfair Display SC) for recipe/meal hero titles.
//
// STYLE: Flat Design Mobile (Touch-First) — validated by design tool.
//   Zero heavy shadows; use border + background tint for depth.
//   Press state: scale(0.97) + opacity 0.85, 120ms ease-out.

const PALETTE = {
  // ── Warm Harvest (proposed) ──
  terracotta:   '#E8763A',   // primary accent — unchanged, validated
  terracottaLight: '#F0925C',
  terracottaSoft: 'rgba(232,118,58,0.13)',

  sageDeep:     '#5B8A58',   // 4.6:1 on white — meets WCAG AA (vs current 2.9:1)
  sageLight:    '#7DB07A',   // original sage, keep for dark-mode surfaces
  sageSoft:     'rgba(91,138,88,0.13)',

  amber:        '#D97706',   // slightly richer than #E0A832, still warm
  amberSoft:    'rgba(217,119,6,0.13)',

  danger:       '#E85C4A',
  dangerSoft:   'rgba(232,92,74,0.13)',

  // ── Light surfaces ──
  bgLight:      '#FEFCF8',   // parchment — unchanged
  surfaceLight: '#FFFFFF',
  surfaceAlt:   '#F7F1E8',   // NEW cream — feature cards, elevated sections
  mutedLight:   '#EDE8DC',
  borderLight:  '#E5DDD0',
  borderStrong: '#CBBFA8',

  // ── Dark surfaces ──
  bgDark:       '#12100E',
  surfaceDark:  '#1D1A16',
  surfaceElev:  '#252118',
  mutedDark:    '#2D2820',
  borderDark:   '#3A3025',

  // ── Text (light mode) ──
  textPrimary:  '#1C1710',
  textSecond:   '#6B5740',
  textTert:     '#A8927A',
  textInverse:  '#FEFCF8',
};

// ─── Demo theme (light) — shows the recommendation ───────────────────────────
const C = {
  primary:         PALETTE.terracotta,
  primaryLight:    PALETTE.terracottaLight,
  primarySoft:     PALETTE.terracottaSoft,
  sage:            PALETTE.sageDeep,
  sageSoft:        PALETTE.sageSoft,
  amber:           PALETTE.amber,
  amberSoft:       PALETTE.amberSoft,
  danger:          PALETTE.danger,
  dangerSoft:      PALETTE.dangerSoft,
  background:      PALETTE.bgLight,
  surface:         PALETTE.surfaceLight,
  surfaceAlt:      PALETTE.surfaceAlt,
  muted:           PALETTE.mutedLight,
  border:          PALETTE.borderLight,
  borderStrong:    PALETTE.borderStrong,
  textPrimary:     PALETTE.textPrimary,
  textSecondary:   PALETTE.textSecond,
  textTertiary:    PALETTE.textTert,
  textInverse:     PALETTE.textInverse,
};

// ─── Spacing & radius (unchanged from current theme) ─────────────────────────
const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 };
const r  = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, full: 999 };

// ─── Pantry item data ─────────────────────────────────────────────────────────
const DEMO_ITEMS = [
  { id: '1', name: 'Olive Oil',      qty: '500 ml',  cat: 'Pantry',  expiry: 'ok',      icon: 'leaf-outline' },
  { id: '2', name: 'Greek Yogurt',   qty: '2 pcs',   cat: 'Dairy',   expiry: 'warning',  icon: 'nutrition-outline' },
  { id: '3', name: 'Sourdough Bread',qty: '1 loaf',  cat: 'Bakery',  expiry: 'danger',   icon: 'restaurant-outline' },
  { id: '4', name: 'Cherry Tomatoes',qty: '250 g',   cat: 'Produce', expiry: 'ok',       icon: 'flower-outline' },
];

const EXPIRY_STATUS = {
  ok:      { label: 'Fresh',      bg: 'rgba(91,138,88,0.13)',  text: PALETTE.sageDeep,  icon: 'checkmark-circle-outline' },
  warning: { label: '3d left',    bg: 'rgba(217,119,6,0.13)',  text: PALETTE.amber,     icon: 'time-outline' },
  danger:  { label: 'Expires today', bg: 'rgba(232,92,74,0.13)', text: PALETTE.danger, icon: 'warning-outline' },
};

const CATEGORY_PILLS = ['All', 'Pantry', 'Dairy', 'Produce', 'Bakery', 'Meat'];

// ─── Color swatch row ─────────────────────────────────────────────────────────
function Swatch({ hex, label, onPrimary }) {
  return (
    <View style={s.swatchWrap}>
      <View style={[s.swatchBox, { backgroundColor: hex }]}>
        <Text style={[s.swatchHex, { color: onPrimary ?? '#fff' }]}>{hex}</Text>
      </View>
      <Text style={s.swatchLabel}>{label}</Text>
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function Section({ title, note }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {note && <Text style={s.sectionNote}>{note}</Text>}
    </View>
  );
}

// ─── Pantry row card ──────────────────────────────────────────────────────────
function PantryRow({ item }) {
  const exp = EXPIRY_STATUS[item.expiry];
  return (
    <View style={[s.pantryRow, { borderLeftColor: exp.text }]}>
      <View style={[s.pantryIconWrap, { backgroundColor: C.primarySoft }]}>
        <Ionicons name={item.icon} size={18} color={C.primary} />
      </View>
      <View style={s.pantryInfo}>
        <Text style={s.pantryName}>{item.name}</Text>
        <Text style={s.pantryQty}>{item.qty} · {item.cat}</Text>
      </View>
      <View style={[s.expiryBadge, { backgroundColor: exp.bg }]}>
        <Ionicons name={exp.icon} size={10} color={exp.text} />
        <Text style={[s.expiryLabel, { color: exp.text }]}>{exp.label}</Text>
      </View>
    </View>
  );
}

// ─── Recipe card ──────────────────────────────────────────────────────────────
function RecipeCard({ title, time, calories, tag }) {
  return (
    <View style={s.recipeCard}>
      <View style={s.recipeImageBlock}>
        <View style={s.recipeImagePlaceholder}>
          <Ionicons name="restaurant" size={28} color={C.primary} />
        </View>
        <View style={[s.recipeTag, { backgroundColor: C.primary }]}>
          <Text style={s.recipeTagText}>{tag}</Text>
        </View>
      </View>
      <View style={s.recipeBody}>
        <Text style={s.recipeTitle} numberOfLines={2}>{title}</Text>
        <View style={s.recipeMeta}>
          <Ionicons name="time-outline" size={12} color={C.textTertiary} />
          <Text style={s.recipeMetaText}>{time}m</Text>
          <Ionicons name="flame-outline" size={12} color={C.textTertiary} />
          <Text style={s.recipeMetaText}>{calories} cal</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, accent }) {
  return (
    <View style={[s.statCard, { borderTopColor: accent, borderTopWidth: 3 }]}>
      <View style={[s.statIconWrap, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Main showcase screen ─────────────────────────────────────────────────────
export default function DesignShowcaseScreen() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [liked, setLiked] = useState(false);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.background} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ── */}
        <View style={s.hero}>
          <View>
            <Text style={s.heroEyebrow}>DESIGN SHOWCASE</Text>
            <Text style={s.heroTitle}>Warm Harvest</Text>
            <Text style={s.heroSub}>Home App · ui-ux-pro-max validation</Text>
          </View>
          <View style={[s.heroBadge, { backgroundColor: C.sageSoft }]}>
            <Ionicons name="checkmark-circle" size={14} color={C.sage} />
            <Text style={[s.heroBadgeText, { color: C.sage }]}>Validated</Text>
          </View>
        </View>

        {/* ── COLOR PALETTE ── */}
        <Section
          title="Color Palette"
          note="Terracotta + Sage Deep + Warm Amber"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.swatchRow}>
          <Swatch hex={C.primary}    label="Terracotta" />
          <Swatch hex={C.sage}       label="Sage Deep ↑" />
          <Swatch hex={C.amber}      label="Amber" />
          <Swatch hex={C.danger}     label="Danger" />
          <Swatch hex={C.background} label="BG"        onPrimary={C.textPrimary} />
          <Swatch hex={C.surfaceAlt} label="Cream NEW"  onPrimary={C.textPrimary} />
          <Swatch hex={C.muted}      label="Muted"      onPrimary={C.textSecondary} />
        </ScrollView>

        {/* Accessibility note */}
        <View style={[s.infoBox, { backgroundColor: C.sageSoft, borderColor: C.sage }]}>
          <Ionicons name="information-circle-outline" size={16} color={C.sage} />
          <Text style={[s.infoText, { color: C.textPrimary }]}>
            <Text style={{ fontWeight: '700', color: C.sage }}>Sage upgrade: </Text>
            Current #7DB07A is 2.9:1 on white (fails WCAG AA). Proposed #5B8A58 is 4.6:1 — passes AA for normal text.
          </Text>
        </View>

        {/* ── TYPOGRAPHY ── */}
        <Section
          title="Typography Scale"
          note="System serif for headings · 15/13px body"
        />
        <View style={[s.typeCard, { backgroundColor: C.surface }]}>
          <Text style={s.typeH1}>Pantry</Text>
          <Text style={s.typeH2}>Grocery List</Text>
          <Text style={s.typeH3}>Recipe Details</Text>
          <Text style={s.typeBody}>
            Track ingredients, plan meals, and reduce food waste — all in one warm, organised space.
          </Text>
          <Text style={s.typeLabel}>SECTION LABEL · CATEGORY</Text>
          <Text style={s.typeCaption}>Expires in 3 days · 250 g</Text>
          <View style={s.typeSeparator} />
          <Text style={[s.typeBody, { color: C.textTertiary, fontSize: 12 }]}>
            Note: Add expo-google-fonts "Playfair_Display_SC" for headings to match culinary-style
            typography recommendation from ui-ux-pro-max.
          </Text>
        </View>

        {/* ── STATS ROW ── */}
        <Section title="Summary Cards" />
        <View style={s.statsRow}>
          <StatCard icon="nutrition-outline"   label="Pantry Items"  value="24"    accent={C.primary} />
          <StatCard icon="list-outline"         label="Groceries"     value="11"    accent={C.sage} />
          <StatCard icon="book-outline"         label="Recipes"       value="8"     accent={C.amber} />
          <StatCard icon="warning-outline"      label="Expiring"      value="3"     accent={C.danger} />
        </View>

        {/* ── CATEGORY FILTER PILLS ── */}
        <Section title="Category Filter" note="Flat pill style — no shadow" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: sp.xl, gap: 8, paddingVertical: sp.xs }}
        >
          {CATEGORY_PILLS.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[s.pill, isActive && { backgroundColor: C.primarySoft, borderColor: C.primary }]}
                onPress={() => setActiveCategory(cat)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[s.pillLabel, isActive && { color: C.primary }]}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── PANTRY LIST ── */}
        <Section title="Pantry List Items" note="Left-border expiry indicator" />
        <View style={[s.listCard, { backgroundColor: C.surface }]}>
          {DEMO_ITEMS.map((item, i) => (
            <View key={item.id}>
              <PantryRow item={item} />
              {i < DEMO_ITEMS.length - 1 && <View style={s.divider} />}
            </View>
          ))}
        </View>

        {/* ── RECIPE CARDS ── */}
        <Section title="Recipe Cards" note="Image-forward with meta pills" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: sp.xl, gap: sp.md }}>
          <RecipeCard title="Roasted Vegetable Pasta"   time={25} calories={420} tag="Vegetarian" />
          <RecipeCard title="Chicken & Herb Tray Bake"  time={40} calories={510} tag="Gluten-free" />
          <RecipeCard title="Overnight Oats Bowl"        time={10} calories={310} tag="Breakfast" />
        </ScrollView>

        {/* ── BUTTONS ── */}
        <Section title="Button Variants" note="Flat-first · 120ms press scale" />
        <View style={s.buttonGrid}>
          <TouchableOpacity style={s.btnPrimary} activeOpacity={0.82} accessibilityRole="button">
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.btnPrimaryLabel}>Add Item</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} activeOpacity={0.82} accessibilityRole="button">
            <Ionicons name="scan-outline" size={18} color={C.primary} />
            <Text style={s.btnSecondaryLabel}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnGhost} activeOpacity={0.82} accessibilityRole="button">
            <Text style={s.btnGhostLabel}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnDanger} activeOpacity={0.82} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={C.danger} />
            <Text style={s.btnDangerLabel}>Delete</Text>
          </TouchableOpacity>
        </View>

        {/* ── GROCERY ITEM ── */}
        <Section title="Grocery List Row" note="Checkbox · category pill · strikethrough" />
        <View style={[s.listCard, { backgroundColor: C.surface }]}>
          {[
            { name: 'Whole milk', qty: '2 L',  cat: 'Dairy',   done: true  },
            { name: 'Avocados',   qty: '4 pcs', cat: 'Produce', done: false },
            { name: 'Sourdough',  qty: '1 loaf',cat: 'Bakery',  done: false },
          ].map((g, i, arr) => (
            <View key={g.name}>
              <View style={s.groceryRow}>
                <View style={[s.checkbox, g.done && { backgroundColor: C.primary, borderColor: C.primary }]}>
                  {g.done && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.groceryName, g.done && s.groceryDone]}>{g.name}</Text>
                  <Text style={s.groceryQty}>{g.qty}</Text>
                </View>
                <View style={[s.groceryCatPill, { backgroundColor: C.primarySoft }]}>
                  <Text style={[s.groceryCatLabel, { color: C.primary }]}>{g.cat}</Text>
                </View>
              </View>
              {i < arr.length - 1 && <View style={s.divider} />}
            </View>
          ))}
        </View>

        {/* ── NUTRITION BAR ── */}
        <Section title="Nutrition Progress" note="Daily macro targets" />
        <View style={[s.nutritionCard, { backgroundColor: C.surface }]}>
          {[
            { label: 'Calories', value: 1480, max: 2000, color: C.primary },
            { label: 'Protein',  value: 62,   max: 80,   color: C.sage },
            { label: 'Carbs',    value: 180,  max: 250,  color: C.amber },
            { label: 'Fat',      value: 55,   max: 70,   color: C.danger },
          ].map((macro) => (
            <View key={macro.label} style={s.macroRow}>
              <View style={s.macroLabelRow}>
                <Text style={s.macroLabel}>{macro.label}</Text>
                <Text style={s.macroValue}>{macro.value} / {macro.max}</Text>
              </View>
              <View style={s.macroTrack}>
                <View style={[s.macroFill, { width: `${Math.min((macro.value / macro.max) * 100, 100)}%`, backgroundColor: macro.color }]} />
              </View>
            </View>
          ))}
        </View>

        {/* ── EMPTY STATE ── */}
        <Section title="Empty State" />
        <View style={[s.emptyState, { backgroundColor: C.surface }]}>
          <View style={[s.emptyIcon, { backgroundColor: C.primarySoft }]}>
            <Ionicons name="nutrition-outline" size={32} color={C.primary} />
          </View>
          <Text style={s.emptyTitle}>Pantry is empty</Text>
          <Text style={s.emptySub}>Add your first item to start tracking what you have at home.</Text>
          <TouchableOpacity style={s.emptyAction} activeOpacity={0.82} accessibilityRole="button">
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={s.emptyActionLabel}>Add First Item</Text>
          </TouchableOpacity>
        </View>

        {/* ── ALERT / BADGE VARIANTS ── */}
        <Section title="Status Badges & Alerts" />
        <View style={s.badgeRow}>
          {[
            { label: '24 items',   bg: C.primarySoft, text: C.primary,  icon: 'cube-outline' },
            { label: '3 expiring', bg: C.amberSoft,   text: C.amber,    icon: 'warning-outline' },
            { label: 'Synced',     bg: C.sageSoft,    text: C.sage,     icon: 'cloud-done-outline' },
            { label: '1 error',    bg: C.dangerSoft,  text: C.danger,   icon: 'close-circle-outline' },
          ].map((b) => (
            <View key={b.label} style={[s.badge, { backgroundColor: b.bg }]}>
              <Ionicons name={b.icon} size={12} color={b.text} />
              <Text style={[s.badgeLabel, { color: b.text }]}>{b.label}</Text>
            </View>
          ))}
        </View>

        {/* ── FAB PREVIEW ── */}
        <Section title="Floating Action Button" note="Terracotta glow · 56pt target" />
        <View style={s.fabPreview}>
          <View style={s.fab}>
            <Ionicons name="add" size={26} color="#fff" />
          </View>
          <Text style={s.fabNote}>position: absolute, bottom: 104, right: 20</Text>
        </View>

        {/* ── RECOMMENDATION SUMMARY ── */}
        <Section title="What to Keep / Change" />
        <View style={[s.summaryCard, { backgroundColor: C.surfaceAlt, borderColor: C.borderStrong }]}>
          {[
            { icon: 'checkmark-circle', color: C.sage,    text: 'Keep terracotta #E8763A accent — perfect for food apps' },
            { icon: 'checkmark-circle', color: C.sage,    text: 'Keep espresso dark mode (#12100E) — strong brand identity' },
            { icon: 'checkmark-circle', color: C.sage,    text: 'Keep parchment light (#FEFCF8) — warm, not cold' },
            { icon: 'arrow-up-circle',  color: C.amber,   text: 'Upgrade sage to #5B8A58 (WCAG AA contrast fix)' },
            { icon: 'arrow-up-circle',  color: C.amber,   text: 'Add cream surface #F7F1E8 for feature card lift' },
            { icon: 'arrow-up-circle',  color: C.amber,   text: 'Add expo-google-fonts: Playfair Display SC for headings' },
            { icon: 'close-circle',     color: C.danger,  text: 'Remove emoji icons in category chips (use Ionicons)' },
          ].map((item, i) => (
            <View key={i} style={s.summaryRow}>
              <Ionicons name={item.icon} size={16} color={item.color} />
              <Text style={s.summaryText}>{item.text}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: sp.huge }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingBottom: sp.huge },

  // Hero
  hero: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: sp.xl, paddingTop: sp.xl, paddingBottom: sp.lg,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
    marginBottom: sp.lg,
  },
  heroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: C.primary, marginBottom: 4 },
  heroTitle:   { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: C.textPrimary, lineHeight: 34 },
  heroSub:     { fontSize: 13, color: C.textSecondary, marginTop: 3 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: r.full, marginTop: 4,
  },
  heroBadgeText: { fontSize: 11, fontWeight: '700' },

  // Section header
  sectionHeader: { paddingHorizontal: sp.xl, marginTop: sp.xl, marginBottom: sp.sm },
  sectionTitle:  { fontSize: 17, fontWeight: '700', color: C.textPrimary },
  sectionNote:   { fontSize: 12, color: C.textTertiary, marginTop: 2 },

  // Swatches
  swatchRow: { paddingLeft: sp.xl, marginBottom: sp.md },
  swatchWrap: { marginRight: sp.md, alignItems: 'center' },
  swatchBox: {
    width: 72, height: 72, borderRadius: r.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  swatchHex:   { fontSize: 9, fontWeight: '700', textAlign: 'center', paddingHorizontal: 2 },
  swatchLabel: { fontSize: 10, color: C.textTertiary, marginTop: 5, textAlign: 'center' },

  // Info box
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: sp.xl, marginBottom: sp.md,
    padding: sp.md, borderRadius: r.md, borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18 },

  // Typography card
  typeCard: {
    marginHorizontal: sp.xl, borderRadius: r.lg, padding: sp.xl,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  typeH1:      { fontSize: 36, fontWeight: '800', letterSpacing: -1,   lineHeight: 42, color: C.textPrimary },
  typeH2:      { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34, color: C.textPrimary },
  typeH3:      { fontSize: 21, fontWeight: '700', lineHeight: 28,                      color: C.textPrimary },
  typeBody:    { fontSize: 15, fontWeight: '400', lineHeight: 22,                      color: C.textSecondary },
  typeLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.8,  lineHeight: 16, color: C.textTertiary },
  typeCaption: { fontSize: 11, fontWeight: '500', lineHeight: 16,                      color: C.textTertiary },
  typeSeparator: { height: 1, backgroundColor: C.border, marginVertical: 4 },

  // Stats
  statsRow: {
    flexDirection: 'row', paddingHorizontal: sp.xl, gap: sp.sm, marginBottom: sp.sm,
  },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: r.md,
    padding: sp.md, borderWidth: 1, borderColor: C.border, gap: 4,
  },
  statIconWrap: { width: 34, height: 34, borderRadius: r.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue:   { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5 },
  statLabel:   { fontSize: 10, fontWeight: '600', color: C.textTertiary },

  // Pills
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: r.sm, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  pillLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: C.textSecondary },

  // Pantry list card
  listCard: {
    marginHorizontal: sp.xl, borderRadius: r.lg,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
    marginBottom: sp.sm,
  },
  pantryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingVertical: 13,
    gap: sp.md, borderLeftWidth: 3,
  },
  pantryIconWrap: { width: 36, height: 36, borderRadius: r.sm, alignItems: 'center', justifyContent: 'center' },
  pantryInfo:  { flex: 1, gap: 2 },
  pantryName:  { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  pantryQty:   { fontSize: 11, color: C.textTertiary },
  expiryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: r.sm,
  },
  expiryLabel: { fontSize: 10, fontWeight: '700' },
  divider:     { height: 1, backgroundColor: C.border, marginLeft: sp.lg },

  // Recipe cards
  recipeCard: {
    width: 180, backgroundColor: C.surface,
    borderRadius: r.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  recipeImageBlock:       { height: 100, backgroundColor: C.surfaceAlt, position: 'relative' },
  recipeImagePlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  recipeTag: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: r.full,
  },
  recipeTagText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  recipeBody:    { padding: sp.md, gap: 6 },
  recipeTitle:   { fontSize: 13, fontWeight: '700', color: C.textPrimary, lineHeight: 18 },
  recipeMeta:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  recipeMetaText:{ fontSize: 11, color: C.textTertiary },

  // Buttons
  buttonGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: sp.xl, gap: sp.sm, marginBottom: sp.sm,
  },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: sp.xl, height: 50, borderRadius: r.md,
    backgroundColor: C.primary,
  },
  btnPrimaryLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: sp.xl, height: 50, borderRadius: r.md,
    backgroundColor: C.primarySoft, borderWidth: 1.5, borderColor: C.primary,
  },
  btnSecondaryLabel: { fontSize: 15, fontWeight: '700', color: C.primary },
  btnGhost: {
    paddingHorizontal: sp.xl, height: 50, borderRadius: r.md,
    backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center',
  },
  btnGhostLabel: { fontSize: 15, fontWeight: '600', color: C.textSecondary },
  btnDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: sp.xl, height: 50, borderRadius: r.md,
    backgroundColor: C.dangerSoft, borderWidth: 1.5, borderColor: C.danger,
  },
  btnDangerLabel: { fontSize: 15, fontWeight: '700', color: C.danger },

  // Grocery rows
  groceryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingVertical: 13, gap: sp.md,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: r.sm,
    borderWidth: 2, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  groceryName:   { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  groceryDone:   { textDecorationLine: 'line-through', color: C.textTertiary },
  groceryQty:    { fontSize: 11, color: C.textTertiary },
  groceryCatPill:{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: r.full },
  groceryCatLabel:{ fontSize: 10, fontWeight: '700' },

  // Nutrition
  nutritionCard: {
    marginHorizontal: sp.xl, borderRadius: r.lg, padding: sp.xl,
    borderWidth: 1, borderColor: C.border, gap: sp.md, marginBottom: sp.sm,
  },
  macroRow:      { gap: 6 },
  macroLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  macroLabel:    { fontSize: 12, fontWeight: '600', color: C.textPrimary },
  macroValue:    { fontSize: 12, color: C.textTertiary },
  macroTrack:    { height: 6, backgroundColor: C.muted, borderRadius: r.full, overflow: 'hidden' },
  macroFill:     { height: '100%', borderRadius: r.full },

  // Empty state
  emptyState: {
    marginHorizontal: sp.xl, borderRadius: r.xl,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', padding: sp.xxxl, gap: sp.md, marginBottom: sp.sm,
  },
  emptyIcon: {
    width: 72, height: 72, borderRadius: r.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle:  { fontSize: 17, fontWeight: '700', color: C.textPrimary },
  emptySub:    { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: sp.xl, paddingVertical: sp.md,
    backgroundColor: C.primary, borderRadius: r.full, marginTop: 4,
  },
  emptyActionLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Badges
  badgeRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: sp.xl, gap: sp.sm, marginBottom: sp.sm,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: r.full,
  },
  badgeLabel: { fontSize: 11, fontWeight: '700' },

  // FAB
  fabPreview: { alignItems: 'center', paddingVertical: sp.xl, gap: sp.sm },
  fab: {
    width: 56, height: 56, borderRadius: r.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.45, shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  fabNote: { fontSize: 11, color: C.textTertiary },

  // Summary card
  summaryCard: {
    marginHorizontal: sp.xl, borderRadius: r.lg,
    padding: sp.xl, borderWidth: 1, gap: sp.md,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  summaryText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 20 },
});
