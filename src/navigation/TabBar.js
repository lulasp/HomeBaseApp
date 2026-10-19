import React, { useMemo, useRef, useEffect, memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, Animated, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useNavScroll } from '../context/NavScrollContext';
import { useHousehold } from '../context/HouseholdContext';
import { spacing, radius, type } from '../theme/colors';

export const SIDEBAR_WIDTH       = 220;
export const DESKTOP_BREAKPOINT  = 1322;
export const DESKTOP_MAX_CONTENT = 920;

const TAB_CONFIG = {
  Home:       { icon: 'grid',      iconOff: 'grid-outline',      label: 'Overview',  section: 'home'    },
  Grocery:    { icon: 'cart',      iconOff: 'cart-outline',      label: 'Grocery',   section: 'food'    },
  Recipes:    { icon: 'book',      iconOff: 'book-outline',      label: 'Recipes',   section: 'food'    },
  Pantry:     { icon: 'nutrition', iconOff: 'nutrition-outline', label: 'Pantry',    section: 'food'    },
  Nutrition:  { icon: 'calendar',  iconOff: 'calendar-outline',  label: 'Nutrition', section: 'food'    },
  AI:                { icon: 'sparkles',     iconOff: 'sparkles-outline',     label: 'AI',         section: 'food'    },
  HomeLights:        { icon: 'bulb',         iconOff: 'bulb-outline',         label: 'Lights',     section: 'home'    },
  Xiaomi:            { icon: 'aperture',     iconOff: 'aperture-outline',     label: 'Xiaomi',     section: 'home'    },
  Bills:             { icon: 'wallet',       iconOff: 'wallet-outline',       label: 'Finances',   section: 'home'    },
  EmergencyContacts: { icon: 'alert-circle', iconOff: 'alert-circle-outline', label: 'Emergency',  section: 'home'    },
  Profile:           { icon: 'person',       iconOff: 'person-outline',       label: 'Profile',    section: 'profile' },
};

const SECTIONS = [
  { key: 'home', label: 'HOME', mobileLabel: 'Home', icon: 'home-outline',       iconActive: 'home'       },
  { key: 'food', label: 'FOOD', mobileLabel: 'Food', icon: 'restaurant-outline', iconActive: 'restaurant' },
];

function getActiveSection(routeName) {
  return TAB_CONFIG[routeName]?.section === 'home' ? 'home' : 'food';
}

export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

// Pill bar (64) + gap + section switcher (40) stacked above it
const MOBILE_NAV_STACK_HEIGHT = 112;

/**
 * How much lower the mobile nav's top edge sits when compact: the section
 * switcher (40 + 8 gap) is hidden and the pill bar shifts down 16.
 * Screens with their own bottom bar shift by this to stay tucked against it.
 */
export const MOBILE_NAV_COMPACT_SHIFT = 64;

function useMobileNavBottom() {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? Math.max(insets.bottom + 8, 24) : 24;
}

/** Space the mobile nav occupies at the bottom — 0 on desktop (sidebar nav). */
export function useMobileNavClearance() {
  const isDesktop = useIsDesktop();
  const barBottom = useMobileNavBottom();
  return isDesktop ? 0 : barBottom + MOBILE_NAV_STACK_HEIGHT + 12;
}

// ── Animated Sidebar Nav Item ──────────────────────────────────────────────────
const AnimatedNavItem = memo(function AnimatedNavItem({ route, isFocused, navigation, tab, styles, colors }) {
  const indicatorScale = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const bgOpacity      = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const iconScale      = useRef(new Animated.Value(isFocused ? 1.1 : 1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(indicatorScale, {
        toValue: isFocused ? 1 : 0,
        friction: 7, tension: 200, useNativeDriver: true,
      }),
      Animated.timing(bgOpacity, {
        toValue: isFocused ? 1 : 0,
        duration: 200, useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: isFocused ? 1.1 : 1,
        friction: 8, tension: 150, useNativeDriver: true,
      }),
    ]).start();
  }, [isFocused]);

  return (
    <TouchableOpacity
      style={styles.navItem}
      onPress={() => navigation.navigate(route.name)}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.accentSoft, borderRadius: radius.md, opacity: bgOpacity },
      ]} />
      <Animated.View style={[
        styles.navActiveIndicator,
        { transform: [{ scaleY: indicatorScale }] },
      ]} />
      <Animated.View style={[
        styles.navIconContainer,
        isFocused && styles.navIconContainerActive,
        { transform: [{ scale: iconScale }] },
      ]}>
        <Ionicons
          name={isFocused ? tab.icon : tab.iconOff}
          size={17}
          color={isFocused ? colors.accent : colors.textTertiary}
        />
      </Animated.View>
      <Text style={[styles.navLabel, isFocused && styles.navLabelActive]}>
        {tab.label}
      </Text>
    </TouchableOpacity>
  );
});

// ── Animated Mobile Tab Item ───────────────────────────────────────────────────
const AnimatedMobileTabItem = memo(function AnimatedMobileTabItem({
  route, isFocused, onPress, tab, styles, colors, labelOpacity, contentTranslateY,
}) {
  const iconScale  = useRef(new Animated.Value(1)).current;
  const wasFocused = useRef(isFocused);

  useEffect(() => {
    const focused = isFocused;
    if (focused && !wasFocused.current) {
      Animated.sequence([
        Animated.timing(iconScale, { toValue: 0.78, duration: 75, useNativeDriver: true }),
        Animated.spring(iconScale, { toValue: 1.08, friction: 6, tension: 220, useNativeDriver: true }),
        Animated.spring(iconScale, { toValue: 1.0,  friction: 8, tension: 150, useNativeDriver: true }),
      ]).start();
    } else if (!focused && wasFocused.current) {
      iconScale.setValue(1);
    }
    wasFocused.current = focused;
  }, [isFocused]);

  return (
    <TouchableOpacity
      style={styles.mobileTabItem}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY: contentTranslateY }] }}>
        {/* Fixed-size container — background never scales */}
        <View style={[
          styles.mobileTabIconContainer,
          isFocused && styles.mobileTabIconContainerActive,
        ]}>
          {/* Only the icon content scales on tap */}
          <Animated.View style={{ transform: [{ scale: iconScale }] }}>
            <Ionicons
              name={isFocused ? tab.icon : tab.iconOff}
              size={20}
              color={isFocused ? colors.accent : colors.textTertiary}
            />
          </Animated.View>
        </View>
        <Animated.Text style={[styles.mobileTabLabel, isFocused && styles.mobileTabLabelActive, { opacity: labelOpacity }]}>
          {tab.label}
        </Animated.Text>
      </Animated.View>
    </TouchableOpacity>
  );
});

// ── Desktop Sidebar ────────────────────────────────────────────────────────────
function DesktopSidebar({ state, navigation, hidden }) {
  const { colors, theme, toggleTheme } = useTheme();
  const styles  = useMemo(() => makeStyles(colors), [colors]);
  const isLight = theme === 'light';

  return (
    <View style={styles.sidebar}>
      {/* Brand — fixed, never scrolls */}
      <View style={styles.brandRow}>
        <View style={styles.brandIconContainer}>
          <Ionicons name="home" size={18} color="#fff" />
        </View>
        <Text style={styles.brandName}>HomeBase</Text>
      </View>

      <View style={styles.sidebarDivider} />

      {/* Scrollable body — flexGrow:1 lets the spacer push footer down when
          there is room; when the viewport is short, the user can scroll. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Section groups */}
        {SECTIONS.map((section, si) => {
          const sectionItems = state.routes
            .map((r, i) => ({ route: r, index: i }))
            .filter(({ route }) => TAB_CONFIG[route.name]?.section === section.key && !hidden.has(route.name));
          return (
            <View key={section.key} style={si > 0 ? styles.sectionGroup : undefined}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <View style={styles.navItemList}>
                {sectionItems.map(({ route, index }) => {
                  const tab = TAB_CONFIG[route.name];
                  if (!tab) return null;
                  return (
                    <AnimatedNavItem
                      key={route.key}
                      route={route}
                      index={index}
                      isFocused={state.index === index}
                      navigation={navigation}
                      tab={tab}
                      styles={styles}
                      colors={colors}
                    />
                  );
                })}
              </View>
            </View>
          );
        })}

        <View style={styles.sidebarDivider} />

        {/* Profile */}
        <View style={styles.navItemList}>
          {state.routes
            .map((r, i) => ({ route: r, index: i }))
            .filter(({ route }) => TAB_CONFIG[route.name]?.section === 'profile')
            .map(({ route, index }) => {
              const tab = TAB_CONFIG[route.name];
              if (!tab) return null;
              return (
                <AnimatedNavItem
                  key={route.key}
                  route={route}
                  index={index}
                  isFocused={state.index === index}
                  navigation={navigation}
                  tab={tab}
                  styles={styles}
                  colors={colors}
                />
              );
            })}
        </View>

        <View style={{ flex: 1 }} />

        {/* Theme toggle */}
        <TouchableOpacity
          style={styles.themeToggleButton}
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          <Ionicons
            name={isLight ? 'moon-outline' : 'sunny-outline'}
            size={15}
            color={isLight ? colors.textSecondary : colors.amber}
          />
          <Text style={styles.themeToggleLabel}>
            {isLight ? 'Dark mode' : 'Light mode'}
          </Text>
        </TouchableOpacity>

        <View style={styles.sidebarFooter}>
          <View style={styles.footerStatusDot} />
          <Text style={styles.footerVersionText}>v1.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Mobile Nav (section switcher + pill bar) ───────────────────────────────────
function MobileNav({ state, navigation, hidden }) {
  const { colors } = useTheme();
  const styles  = useMemo(() => makeStyles(colors), [colors]);
  const { compactAnim, resetCompact } = useNavScroll();

  const focusedRoute  = state.routes[state.index].name;
  const activeSection = getActiveSection(focusedRoute);
  const barBottom     = useMobileNavBottom();

  useEffect(() => { resetCompact(); }, [state.index]);

  const switcherOpacity    = compactAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' });
  const switcherTranslateY = compactAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 18], extrapolate: 'clamp' });
  const tabBarTranslateY   = compactAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 16], extrapolate: 'clamp' });
  const labelOpacity       = compactAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' });
  // Shift icon+label block down to compensate for invisible label still occupying layout space
  const contentTranslateY  = compactAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 8], extrapolate: 'clamp' });

  const switchToSection = (sectionKey) => {
    if (sectionKey === activeSection) return;
    const first = state.routes.find((r) => TAB_CONFIG[r.name]?.section === sectionKey);
    if (first) navigation.navigate(first.name);
  };

  const visibleRoutes = state.routes
    .map((r, i) => ({ route: r, index: i }))
    .filter(({ route }) => {
      if (hidden.has(route.name)) return false;
      const sec = TAB_CONFIG[route.name]?.section;
      return sec === activeSection || sec === 'profile';
    });

  return (
    <>
      {/* Section switcher */}
      <Animated.View style={[
        styles.sectionSwitcher,
        { bottom: barBottom + 72 },
        { opacity: switcherOpacity, transform: [{ translateY: switcherTranslateY }] },
      ]}>
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.key;
          return (
            <TouchableOpacity
              key={section.key}
              style={[styles.sectionBtn, isActive && styles.sectionBtnActive]}
              onPress={() => switchToSection(section.key)}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${section.mobileLabel} area`}
            >
              <Ionicons
                name={isActive ? section.iconActive : section.icon}
                size={13}
                color={isActive ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.sectionBtnLabel, isActive && styles.sectionBtnLabelActive]}>
                {section.mobileLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>

      {/* Tab pill bar */}
      <Animated.View style={[
        styles.mobilePillBar,
        { bottom: barBottom },
        { transform: [{ translateY: tabBarTranslateY }] },
      ]}>
        {visibleRoutes.map(({ route, index }) => {
          const isFocused = state.index === index;
          const tab = TAB_CONFIG[route.name];
          if (!tab) return null;
          return (
            <AnimatedMobileTabItem
              key={route.key}
              route={route}
              index={index}
              isFocused={isFocused}
              onPress={() => navigation.navigate(route.name)}
              tab={tab}
              styles={styles}
              colors={colors}
              labelOpacity={labelOpacity}
              contentTranslateY={contentTranslateY}
            />
          );
        })}
      </Animated.View>
    </>
  );
}

export default function CustomTabBar({ state, navigation }) {
  const isDesktop = useIsDesktop();
  const { goveeEnabled, xiaomiEnabled } = useHousehold();

  // Routes hidden from the bar when their integration is toggled off. The screens
  // stay registered in the navigator — they're just unreachable from the nav.
  const hidden = useMemo(() => {
    const h = new Set();
    if (!goveeEnabled)  h.add('HomeLights');
    if (!xiaomiEnabled) h.add('Xiaomi');
    return h;
  }, [goveeEnabled, xiaomiEnabled]);

  return isDesktop ? (
    <DesktopSidebar state={state} navigation={navigation} hidden={hidden} />
  ) : (
    <MobileNav state={state} navigation={navigation} hidden={hidden} />
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // ── Desktop Sidebar ────────────────────────────────────────────────────────
  sidebar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 36,
    paddingBottom: 28,
    zIndex: 100,
  },
  brandRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 20, marginBottom: 24,
  },
  brandIconContainer: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  brandName: {
    ...type.h4, color: colors.textPrimary, letterSpacing: -0.3,
  },
  sidebarDivider: {
    height: 1, backgroundColor: colors.border,
    marginHorizontal: 20, marginVertical: 16,
  },
  sectionGroup: { marginTop: 4 },
  sectionLabel: {
    ...type.label, color: colors.textTertiary,
    paddingHorizontal: 20, marginBottom: 10,
  },
  navItemList: { gap: 3, paddingHorizontal: 12 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: radius.md, position: 'relative',
    overflow: 'hidden',
  },
  navActiveIndicator: {
    position: 'absolute',
    left: 0, top: 8, bottom: 8,
    width: 3, borderRadius: 2,
    backgroundColor: colors.accent,
  },
  navIconContainer: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  navIconContainerActive: { backgroundColor: colors.accentSoft },
  navLabel:       { ...type.bodyMed, color: colors.textTertiary, fontSize: 14 },
  navLabelActive: { color: colors.accent },

  themeToggleButton: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: 12, marginBottom: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  themeToggleLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '600' },

  sidebarFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20,
  },
  footerStatusDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.sage,
    shadowColor: colors.sage,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  footerVersionText: { ...type.caption, color: colors.textTertiary },

  // ── Mobile Section Switcher ────────────────────────────────────────────────
  sectionSwitcher: {
    position: 'absolute',
    left: 24, right: 24,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
    height: 40,
    alignItems: 'center',
    paddingHorizontal: 5,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
    zIndex: 199,
  },
  sectionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5,
    height: 30, borderRadius: radius.full,
  },
  sectionBtnActive: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(14,165,233,0.35)',
  },
  sectionBtnLabel: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.2,
    color: colors.textTertiary,
  },
  sectionBtnLabelActive: { color: colors.accent },

  // ── Mobile Pill Bar ────────────────────────────────────────────────────────
  mobilePillBar: {
    position: 'absolute',
    left: 24, right: 24,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: 1, borderColor: colors.border,
    height: 64,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.40,
    shadowRadius: 28,
    elevation: 20,
    alignItems: 'center',
    paddingHorizontal: 4,
    zIndex: 198,
  },
  mobileTabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    height: 64, paddingBottom: 8,
  },
  mobileTabIconContainer: {
    width: 40, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
    overflow: 'hidden',
  },
  mobileTabIconContainerActive: { backgroundColor: colors.accentSoft },
  mobileTabLabel:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: colors.textTertiary },
  mobileTabLabelActive: { color: colors.accent },
});
