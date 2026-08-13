import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable,
  SafeAreaView, ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing,
} from 'react-native-reanimated';
import { M, Presence } from '../../components/Motion';
import { useFocusEffect } from '@react-navigation/native';
import { useHousehold } from '../../context/HouseholdContext';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfWeek } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScroll } from '../../context/NavScrollContext';
import { useNotification } from '../../context/NotificationContext';
import {
  getHouseholdWithPrivate, subscribePantryItems, subscribeGroceryItems,
  subscribeBills, subscribeMealPlan, subscribeLightShortcuts,
  subscribeWeeklyTodos, addWeeklyTodo, toggleWeeklyTodo, deleteWeeklyTodo,
} from '../../services/firestore';
import { getDevices } from '../../services/govee';
import LightShortcutsRow from '../../components/LightShortcutsRow';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH } from '../../navigation/TabBar';
import { MEAL_TYPES, FULL_DAYS, DAYS_OF_WEEK } from '../../utils/categories';

const MAX_TODOS_PER_DAY = 15;
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getWeekKey(date) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function greetingIcon() {
  const h = new Date().getHours();
  if (h < 12) return 'sunny-outline';
  if (h < 17) return 'partly-sunny-outline';
  return 'moon-outline';
}

function daysUntilBillDue(dueDayOfMonth) {
  const today = new Date();
  const day = today.getDate();
  if (dueDayOfMonth >= day) return dueDayOfMonth - day;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return (lastDay - day) + dueDayOfMonth;
}

function weatherIcon(code) {
  if (code === 0) return 'sunny';
  if (code <= 3) return 'partly-sunny';
  if (code <= 48) return 'cloudy';
  if (code <= 67) return 'rainy';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rainy';
  return 'thunderstorm';
}

function weatherDesc(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Foggy';
  if (code <= 55) return 'Drizzle';
  if (code <= 67) return 'Rainy';
  if (code <= 77) return 'Snowy';
  if (code <= 82) return 'Showers';
  return 'Thunderstorm';
}

async function fetchWeather() {
  let lat, lon, city;
  try {
    const geo = await fetch('http://ip-api.com/json/?fields=lat,lon,city,status', {
      headers: { Accept: 'application/json' },
    }).then((r) => r.json());
    if (geo.status === 'success') {
      lat = geo.lat; lon = geo.lon; city = geo.city;
    }
  } catch { /* fallback below */ }

  if (lat == null) {
    const geo2 = await fetch('https://ipapi.co/json/').then((r) => r.json());
    lat = geo2.latitude; lon = geo2.longitude; city = geo2.city;
  }

  const w = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
  ).then((r) => r.json());

  return {
    temp: Math.round(w.current.temperature_2m),
    code: w.current.weather_code,
    city: city ?? null,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Staggered entrance: springs up + scales + fades in, delayed by index * 60ms.
// Driven by focus (not mount): the tab navigator keeps this screen mounted, so
// on each focus we snap back to hidden then animate in — guaranteeing a replay
// every visit, not just the first mount.
function AnimatedCard({ index, style, children }) {
  const delay = index * 60;
  return (
    <M
      from={{ opacity: 0, translateY: 28, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 15, stiffness: 140, mass: 0.9, delay }}
      style={style}
    >
      {children}
    </M>
  );
}

// Animated grocery progress bar using pixel width so Reanimated can interpolate it
function AnimatedProgressBar({ progress, color, mutedColor }) {
  const { animationsEnabled } = useHousehold();
  const [trackWidth, setTrackWidth] = useState(0);
  const animWidth = useSharedValue(0);

  useEffect(() => {
    if (trackWidth > 0) {
      const target = progress * trackWidth;
      animWidth.value = animationsEnabled
        ? withSpring(target, { damping: 20, stiffness: 100 })
        : target;
    }
  }, [progress, trackWidth, animationsEnabled]);

  const fillStyle = useAnimatedStyle(() => ({
    width: animWidth.value,
  }));

  return (
    <View
      style={[styles.progressTrack, { backgroundColor: mutedColor }]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.progressFill, { backgroundColor: color }, fillStyle]} />
    </View>
  );
}

// Card wrapper: non-interactive renders as Animated.View; interactive adds spring press-scale
function WidgetCard({ style, children, onPress }) {
  const { animationsEnabled } = useHousehold();
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    if (!animationsEnabled) return;
    scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
  }, [animationsEnabled]);

  const handlePressOut = useCallback(() => {
    if (!animationsEnabled) return;
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  }, [animationsEnabled]);

  if (!onPress) {
    return (
      <Animated.View style={[styles.card, style, animStyle]}>
        {children}
      </Animated.View>
    );
  }

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} style={style}>
      <Animated.View style={[styles.card, style, animStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function WidgetLabel({ icon, label, color }) {
  return (
    <View style={styles.widgetLabelRow}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.widgetLabel, { color }]}>{label}</Text>
    </View>
  );
}

function StatPill({ value, label, icon, color, soft, onPress }) {
  const { animationsEnabled } = useHousehold();
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={onPress}
      onPressIn={() => { if (animationsEnabled) scale.value = withSpring(0.92, { damping: 14, stiffness: 300 }); }}
      onPressOut={() => { if (animationsEnabled) scale.value = withSpring(1, { damping: 14, stiffness: 300 }); }}
    >
      <Animated.View style={[styles.statPill, { backgroundColor: soft }, animStyle]}>
        <Ionicons name={icon} size={18} color={color} />
        <M
          key={value}
          from={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 13, stiffness: 220 }}
        >
          <Text style={[styles.statValue, { color }]}>{value}</Text>
        </M>
        <Text style={styles.statLabel}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

// ── Weekly Calendar ───────────────────────────────────────────────────────────

function WeeklyCalendar({ householdId, weekKey, todayFull, colors }) {
  const { notify } = useNotification();
  const [todos, setTodos] = useState([]);
  const [selectedDay, setSelectedDay] = useState(todayFull);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (!householdId) return;
    return subscribeWeeklyTodos(householdId, weekKey, setTodos);
  }, [householdId, weekKey]);

  const dayTodos = useMemo(
    () => todos.filter((t) => t.day === selectedDay),
    [todos, selectedDay],
  );
  const doneTodos = dayTodos.filter((t) => t.done).length;
  const atCap = dayTodos.length >= MAX_TODOS_PER_DAY;

  const handleAdd = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    if (dayTodos.length >= MAX_TODOS_PER_DAY) {
      notify('Daily limit reached', `You can add up to ${MAX_TODOS_PER_DAY} tasks per day.`, { type: 'warning' });
      return;
    }
    setInputText('');
    try {
      await addWeeklyTodo(householdId, weekKey, selectedDay, text);
    } catch (err) {
      console.error(err);
      setInputText(text);        // keep the text so it isn't lost
      notify('Could not save task', err?.message || 'Please try again.', { type: 'error' });
    }
  }, [inputText, dayTodos.length, householdId, weekKey, selectedDay, notify]);

  return (
    <WidgetCard style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.widgetHeaderRow}>
        <WidgetLabel icon="calendar-outline" label="THIS WEEK" color={colors.textTertiary} />
        {dayTodos.length > 0 && (
          <Text style={[styles.calendarCount, { color: colors.textTertiary }]}>
            {doneTodos}/{dayTodos.length} done
          </Text>
        )}
      </View>

      {/* Day selector */}
      <View style={styles.dayTabsRow}>
        {DAYS_OF_WEEK.map((short, i) => {
          const full = FULL_DAYS[i];
          const isToday = full === todayFull;
          const isSelected = full === selectedDay;
          const pending = todos.filter((t) => t.day === full && !t.done).length;
          return (
            <Pressable
              key={full}
              style={{ flex: 1 }}
              onPress={() => setSelectedDay(full)}
              accessibilityRole="button"
              accessibilityLabel={full}
              accessibilityState={{ selected: isSelected }}
            >
              <M
                style={[
                  styles.dayTab,
                  { backgroundColor: colors.muted },
                  isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.accent },
                  isSelected && { backgroundColor: colors.accent },
                ]}
                animate={{ scale: isSelected ? 1.08 : 1 }}
                transition={{ type: 'spring', damping: 13, stiffness: 260 }}
              >
                <Text style={[
                  styles.dayTabText,
                  { color: isSelected ? '#fff' : colors.textSecondary },
                  isToday && !isSelected && { color: colors.accent },
                ]}>
                  {short}
                </Text>
                {pending > 0 && (
                  <View style={[
                    styles.dayTabDot,
                    { backgroundColor: isSelected ? 'rgba(255,255,255,0.6)' : colors.accent },
                  ]} />
                )}
              </M>
            </Pressable>
          );
        })}
      </View>

      {/* Todo list */}
      {dayTodos.length === 0 && (
        <Text style={[styles.calendarEmpty, { color: colors.textTertiary }]}>
          No tasks for {selectedDay}
        </Text>
      )}
      <Presence>
        {dayTodos.map((todo) => (
          <M
            key={todo.id}
            style={[styles.todoRow, { borderBottomColor: colors.border }]}
            from={{ opacity: 0, translateX: -12 }}
            animate={{ opacity: 1, translateX: 0 }}
            exit={{ opacity: 0, translateX: 12, scale: 0.95 }}
            transition={{ type: 'timing', duration: 260, easing: Easing.out(Easing.cubic) }}
          >
            <TouchableOpacity
              onPress={() => toggleWeeklyTodo(householdId, todo.id, !todo.done).catch(console.error)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <M
                animate={{ scale: todo.done ? [1, 1.25, 1] : 1 }}
                transition={{ type: 'timing', duration: 260 }}
              >
                <Ionicons
                  name={todo.done ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={todo.done ? colors.sage : colors.textTertiary}
                />
              </M>
            </TouchableOpacity>
            <Text
              style={[
                styles.todoText,
                { color: todo.done ? colors.textTertiary : colors.textPrimary },
                todo.done && styles.todoDone,
              ]}
              numberOfLines={2}
            >
              {todo.text}
            </Text>
            <TouchableOpacity
              onPress={() => deleteWeeklyTodo(householdId, todo.id).catch(console.error)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={15} color={colors.textTertiary} />
            </TouchableOpacity>
          </M>
        ))}
      </Presence>

      {/* Add row — always visible so you can add several in a row */}
      {atCap ? (
        <View style={[styles.addTodoBtn, { borderTopColor: colors.border }]}>
          <Text style={[styles.addTodoBtnText, { color: colors.textTertiary }]}>
            Daily limit reached ({MAX_TODOS_PER_DAY})
          </Text>
        </View>
      ) : (
        <View style={[styles.todoAddRow, { borderTopColor: dayTodos.length > 0 ? colors.border : 'transparent' }]}>
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
          <TextInput
            style={[styles.todoInput, { color: colors.textPrimary }]}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleAdd}
            blurOnSubmit={false}
            placeholder="Add a task…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            autoCapitalize="sentences"
          />
          {inputText.trim().length > 0 && (
            <TouchableOpacity
              onPress={handleAdd}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-up-circle" size={22} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </WidgetCard>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const { user, householdId, displayName } = useAuth();
  const { colors } = useTheme();
  const { handleScroll } = useNavScroll();
  const isDesktop = useIsDesktop();
  const { animationsEnabled } = useHousehold();

  const today       = new Date();
  const todayFull   = FULL_DAYS[today.getDay() === 0 ? 6 : today.getDay() - 1]; // Mon=0 offset
  const weekKey     = getWeekKey(today);
  const dateLabel   = `${DAYS_SHORT[today.getDay()]}, ${MONTH_NAMES[today.getMonth()]} ${today.getDate()}`;
  const initials    = (displayName || user?.email || 'Y').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  const [household,    setHousehold]    = useState(null);
  const [pantryItems,  setPantryItems]  = useState([]);
  const [groceryItems, setGroceryItems] = useState([]);
  const [bills,        setBills]        = useState([]);
  const [mealPlan,     setMealPlan]     = useState({});
  const [lights,       setLights]       = useState(null);
  const [goveeApiKey,  setGoveeApiKey]  = useState(null);
  const [goveeDevices, setGoveeDevices] = useState([]);
  const [lightShortcuts, setLightShortcuts] = useState([]);
  const [weather,      setWeather]      = useState(null);
  const [weatherError, setWeatherError] = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);

  // ── Entrance replay ───────────────────────────────────────────────────────────
  // Remount the scroll content on every focus so all mount animations replay
  // identically to first load. Skip the initial focus (the mount already plays
  // them) to avoid a double. Firestore subscriptions live outside this subtree,
  // so remounting doesn't touch them.
  const [contentKey, setContentKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      if (animationsEnabled) setContentKey((k) => k + 1);
    }, [animationsEnabled]),
  );

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadAsync = useCallback(async () => {
    if (!householdId) return;
    let apiKey = null;
    try {
      const hh = await getHouseholdWithPrivate(householdId);
      setHousehold(hh);
      apiKey = hh?.goveeApiKey ?? null;
      setGoveeApiKey(apiKey);
    } catch { /* silent */ }

    try {
      const devices = apiKey ? await getDevices(apiKey) : [];
      setGoveeDevices(devices);
      setLights({ total: devices.length });
    } catch { setLights({ total: 0 }); }

    try {
      setWeatherError(false);
      const w = await fetchWeather();
      setWeather(w);
    } catch { setWeatherError(true); }
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    const unsubs = [
      subscribePantryItems(householdId, setPantryItems),
      subscribeGroceryItems(householdId, setGroceryItems),
      subscribeBills(householdId, setBills),
      subscribeMealPlan(householdId, weekKey, setMealPlan),
      subscribeLightShortcuts(householdId, (data) =>
        setLightShortcuts(data.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))),
      ),
    ];
    loadAsync();
    return () => unsubs.forEach((u) => u?.());
  }, [householdId, weekKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAsync();
    setRefreshing(false);
  }, [loadAsync]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const pendingGrocery = useMemo(() => groceryItems.filter((i) => !i.checked).length, [groceryItems]);
  const checkedGrocery = useMemo(() => groceryItems.filter((i) => i.checked).length, [groceryItems]);
  const lowPantry      = useMemo(
    () => pantryItems.filter((i) => parseFloat(i.quantity) <= 2).sort((a, b) => parseFloat(a.quantity) - parseFloat(b.quantity)),
    [pantryItems],
  );
  const nextBill = useMemo(() => {
    if (!bills.length) return null;
    const monthKey = format(today, 'yyyy-MM');
    return [...bills]
      .filter((b) => !b.paidMonths?.includes(monthKey))
      .sort((a, b) => daysUntilBillDue(a.dueDayOfMonth) - daysUntilBillDue(b.dueDayOfMonth))[0] || null;
  }, [bills]);

  const todayMeals = useMemo(() => {
    const day = mealPlan[todayFull] || {};
    return MEAL_TYPES.slice(0, 3).map((m) => ({ type: m, meal: day[m] || null }));
  }, [mealPlan, todayFull]);

  const memberCount = household?.members?.length ?? 0;
  const groceryProgress = groceryItems.length ? checkedGrocery / groceryItems.length : 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        key={contentKey}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >

        {/* ── Greeting ──────────────────────────────────────────────────── */}
        <AnimatedCard index={0}>
          <View style={[styles.greetingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.greetingTop}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                <Text style={[styles.avatarText, { color: colors.accent }]}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.greetingIconRow}>
                  <Ionicons name={greetingIcon()} size={14} color={colors.amber} />
                  <Text style={[styles.greetingTime, { color: colors.textTertiary }]}>{greeting()}</Text>
                </View>
                <Text style={[styles.greetingName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {displayName || 'Welcome'}
                </Text>
              </View>
              <View style={[styles.dateBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.dateBadgeText, { color: colors.textSecondary }]}>{dateLabel}</Text>
              </View>
            </View>
            {memberCount > 0 && (
              <View style={[styles.householdRow, { borderTopColor: colors.border }]}>
                <Ionicons name="home-outline" size={12} color={colors.textTertiary} />
                <Text style={[styles.householdText, { color: colors.textTertiary }]}>
                  {household?.name || 'Your household'} · {memberCount} member{memberCount !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </AnimatedCard>

        {/* ── Light shortcuts ───────────────────────────────────────────── */}
        {lightShortcuts.length > 0 && (
          <AnimatedCard index={1}>
            <LightShortcutsRow
              householdId={householdId}
              apiKey={goveeApiKey}
              devices={goveeDevices}
              shortcuts={lightShortcuts}
              onCreateNew={() => navigation.navigate('HomeLights', { createShortcut: Date.now() })}
            />
          </AnimatedCard>
        )}

        {/* ── Quick stats ───────────────────────────────────────────────── */}
        <AnimatedCard index={1}>
          <View style={styles.statsRow}>
            <StatPill
              value={pendingGrocery}
              label="to buy"
              icon="cart-outline"
              color={colors.accent}
              soft={colors.accentSoft}
              onPress={() => navigation.navigate('Grocery')}
            />
            <StatPill
              value={lowPantry.length}
              label="low stock"
              icon="warning-outline"
              color={colors.amber}
              soft={colors.amberSoft}
              onPress={() => navigation.navigate('Pantry')}
            />
            <StatPill
              value={bills.length}
              label="bills"
              icon="card-outline"
              color={colors.sage}
              soft={colors.sageSoft}
              onPress={() => navigation.navigate('Bills')}
            />
          </View>
        </AnimatedCard>

        {/* ── Weekly calendar ───────────────────────────────────────────── */}
        <AnimatedCard index={2}>
          <WeeklyCalendar
            householdId={householdId}
            weekKey={weekKey}
            todayFull={todayFull}
            colors={colors}
          />
        </AnimatedCard>

        {/* ── Weather + Lights ──────────────────────────────────────────── */}
        <AnimatedCard index={3}>
          <View style={styles.twoCol}>
            {/* Weather */}
            <WidgetCard style={[styles.halfCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <WidgetLabel icon="cloud-outline" label="WEATHER" color={colors.textTertiary} />
              {weather ? (
                <>
                  <M
                    style={styles.weatherMain}
                    from={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 180 }}
                  >
                    <M
                      from={{ translateY: -2.5 }}
                      animate={{ translateY: 2.5 }}
                      transition={{ loop: true, repeatReverse: true, type: 'timing', duration: 2200, easing: Easing.inOut(Easing.ease) }}
                    >
                      <Ionicons name={weatherIcon(weather.code)} size={30} color={colors.amber} />
                    </M>
                    <Text style={[styles.weatherTemp, { color: colors.textPrimary }]}>{weather.temp}°</Text>
                  </M>
                  <Text style={[styles.weatherDesc, { color: colors.textSecondary }]}>{weatherDesc(weather.code)}</Text>
                  {weather.city ? (
                    <Text style={[styles.weatherCity, { color: colors.textTertiary }]} numberOfLines={1}>{weather.city}</Text>
                  ) : null}
                </>
              ) : weatherError ? (
                <View style={styles.emptyWidget}>
                  <Ionicons name="cloud-offline-outline" size={22} color={colors.textTertiary} />
                  <Text style={[styles.weatherDesc, { color: colors.textTertiary, marginTop: 4 }]}>Unavailable</Text>
                </View>
              ) : (
                <View style={styles.emptyWidget}>
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
              )}
            </WidgetCard>

            {/* Lights */}
            <WidgetCard
              style={[styles.halfCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => navigation.navigate('HomeLights')}
            >
              <WidgetLabel icon="bulb-outline" label="LIGHTS" color={colors.textTertiary} />
              {lights !== null ? (
                <>
                  <View style={styles.lightsRow}>
                    <View style={[styles.lightsIconWrap, { backgroundColor: colors.amberSoft }]}>
                      <Ionicons name="bulb" size={22} color={colors.amber} />
                    </View>
                    <Text style={[styles.lightsCount, { color: colors.textPrimary }]}>
                      {lights.total}
                    </Text>
                  </View>
                  <Text style={[styles.lightsLabel, { color: colors.textSecondary }]}>
                    {lights.total === 0 ? 'No devices' : `device${lights.total !== 1 ? 's' : ''} paired`}
                  </Text>
                  <View style={[styles.viewAllPill, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.viewAllText, { color: colors.textSecondary }]}>Manage →</Text>
                  </View>
                </>
              ) : (
                <View style={styles.emptyWidget}>
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
              )}
            </WidgetCard>
          </View>
        </AnimatedCard>

        {/* ── Next bill ─────────────────────────────────────────────────── */}
        {nextBill ? (
          <AnimatedCard index={4}>
            <WidgetCard
              style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => navigation.navigate('Bills')}
            >
              <WidgetLabel icon="card-outline" label="NEXT BILL DUE" color={colors.textTertiary} />
              <View style={styles.billRow}>
                <View style={[styles.billIconWrap, { backgroundColor: colors.dangerSoft }]}>
                  <Ionicons name="receipt-outline" size={20} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.billName, { color: colors.textPrimary }]} numberOfLines={1}>
                    {nextBill.name}
                  </Text>
                  <Text style={[styles.billDue, { color: colors.textSecondary }]}>
                    Due in {daysUntilBillDue(nextBill.dueDayOfMonth)} day{daysUntilBillDue(nextBill.dueDayOfMonth) !== 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={[styles.billAmount, { color: colors.textPrimary }]}>
                  ${Number(nextBill.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </Text>
              </View>
            </WidgetCard>
          </AnimatedCard>
        ) : null}

        {/* ── Today's meals ─────────────────────────────────────────────── */}
        <AnimatedCard index={5}>
          <WidgetCard
            style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => navigation.navigate('Nutrition')}
          >
            <WidgetLabel icon="restaurant-outline" label="TODAY'S MEALS" color={colors.textTertiary} />
            <View style={styles.mealsGrid}>
              {todayMeals.map(({ type, meal }) => {
                const mealColors = {
                  Breakfast: { bg: colors.amberSoft, text: colors.amber },
                  Lunch:     { bg: colors.sageSoft,  text: colors.sage  },
                  Dinner:    { bg: colors.accentSoft, text: colors.accent },
                };
                const mc = mealColors[type] || { bg: colors.muted, text: colors.textSecondary };
                return (
                  <View key={type} style={[styles.mealSlot, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <View style={[styles.mealTypePill, { backgroundColor: mc.bg }]}>
                      <Text style={[styles.mealTypeText, { color: mc.text }]}>{type.slice(0, 5)}</Text>
                    </View>
                    {meal ? (
                      <Text style={[styles.mealName, { color: colors.textPrimary }]} numberOfLines={2}>{meal.name}</Text>
                    ) : (
                      <Text style={[styles.mealEmpty, { color: colors.textTertiary }]}>Not set</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </WidgetCard>
        </AnimatedCard>

        {/* ── Pantry low ────────────────────────────────────────────────── */}
        {lowPantry.length > 0 && (
          <AnimatedCard index={6}>
            <WidgetCard
              style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => navigation.navigate('Pantry')}
            >
              <View style={styles.widgetHeaderRow}>
                <WidgetLabel icon="warning-outline" label="RUNNING LOW" color={colors.amber} />
                <Text style={[styles.viewAllLink, { color: colors.accent }]}>View pantry →</Text>
              </View>
              <Presence>
                {lowPantry.slice(0, 4).map((item, i) => (
                  <M
                    key={item.id}
                    style={[styles.lowItem, { borderBottomColor: colors.border }]}
                    from={{ opacity: 0, translateX: -10 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    exit={{ opacity: 0, translateX: 10 }}
                    transition={{ type: 'timing', duration: 260, delay: i * 45, easing: Easing.out(Easing.cubic) }}
                  >
                    <View style={[styles.lowItemDot, { backgroundColor: item.quantity <= 1 ? colors.danger : colors.amber }]} />
                    <Text style={[styles.lowItemName, { color: colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.lowItemQty, { color: colors.textTertiary }]}>
                      {item.quantity} {item.unit || ''}
                    </Text>
                  </M>
                ))}
              </Presence>
              {lowPantry.length > 4 && (
                <Text style={[styles.moreItems, { color: colors.textTertiary }]}>
                  +{lowPantry.length - 4} more items
                </Text>
              )}
            </WidgetCard>
          </AnimatedCard>
        )}

        {/* ── Grocery ───────────────────────────────────────────────────── */}
        <AnimatedCard index={7}>
          <WidgetCard
            style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => navigation.navigate('Grocery')}
          >
            <WidgetLabel icon="cart-outline" label="GROCERY LIST" color={colors.textTertiary} />
            {groceryItems.length === 0 ? (
              <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Nothing on the list yet</Text>
            ) : (
              <>
                <View style={styles.groceryProgress}>
                  <AnimatedProgressBar
                    progress={groceryProgress}
                    color={colors.accent}
                    mutedColor={colors.muted}
                  />
                  <Text style={[styles.groceryProgressText, { color: colors.textSecondary }]}>
                    {checkedGrocery}/{groceryItems.length} done
                  </Text>
                </View>
                <Presence>
                  {groceryItems.filter((i) => !i.checked).slice(0, 3).map((item, i) => (
                    <M
                      key={item.id}
                      style={[styles.groceryItem, { borderBottomColor: colors.border }]}
                      from={{ opacity: 0, translateX: -10 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      exit={{ opacity: 0, translateX: 10 }}
                      transition={{ type: 'timing', duration: 260, delay: i * 45, easing: Easing.out(Easing.cubic) }}
                    >
                      <View style={[styles.groceryDot, { borderColor: colors.border }]} />
                      <Text style={[styles.groceryItemName, { color: colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={[styles.groceryItemQty, { color: colors.textTertiary }]}>{item.quantity} {item.unit || ''}</Text>
                    </M>
                  ))}
                </Presence>
                {pendingGrocery > 3 && (
                  <Text style={[styles.moreItems, { color: colors.textTertiary }]}>+{pendingGrocery - 3} more</Text>
                )}
              </>
            )}
          </WidgetCard>
        </AnimatedCard>

        <View style={{ height: 140 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.md },
  contentDesktop: { paddingLeft: SIDEBAR_WIDTH + spacing.xl },

  // Greeting
  greetingCard: {
    borderRadius: radius.xl, borderWidth: 1,
    overflow: 'hidden',
  },
  greetingTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: spacing.lg,
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...type.bodyMed, fontWeight: '800', letterSpacing: 0.5 },
  greetingIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  greetingTime: { ...type.caption, fontWeight: '600', letterSpacing: 0.5 },
  greetingName: { ...type.h4, letterSpacing: -0.2 },
  dateBadge: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
  },
  dateBadgeText: { ...type.caption, fontWeight: '700' },
  householdRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderTopWidth: 1,
  },
  householdText: { ...type.caption, fontWeight: '500' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8 },
  statPill: {
    alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8,
    borderRadius: radius.lg, gap: 3,
  },
  statValue: { ...type.h3, letterSpacing: -0.5 },
  statLabel: { ...type.caption, color: '#7A99BB', fontWeight: '600', textAlign: 'center' },

  // Layout helpers
  twoCol: { flexDirection: 'row', gap: spacing.md },
  card: {
    borderRadius: radius.xl, borderWidth: 1,
    padding: spacing.lg, overflow: 'hidden',
  },
  halfCard: { flex: 1 },
  fullCard: {},

  // Widget label
  widgetLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  widgetLabel: { ...type.label, letterSpacing: 0.8, fontWeight: '700' },
  widgetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  viewAllLink: { ...type.caption, fontWeight: '700' },

  emptyWidget: { height: 60, alignItems: 'center', justifyContent: 'center' },
  emptyHint: { ...type.body, paddingVertical: 8 },

  // Weather
  weatherMain: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  weatherTemp: { ...type.h2, letterSpacing: -1 },
  weatherDesc: { ...type.bodySm, fontWeight: '500', marginBottom: 2 },
  weatherCity: { ...type.caption, marginTop: 2 },

  // Lights
  lightsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  lightsIconWrap: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  lightsCount: { ...type.h2, letterSpacing: -1 },
  lightsLabel: { ...type.bodySm, marginBottom: 10 },
  viewAllPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full,
  },
  viewAllText: { ...type.caption, fontWeight: '700' },

  // Bill
  billRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  billIconWrap: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  billName: { ...type.bodyMed, marginBottom: 2 },
  billDue: { ...type.caption },
  billAmount: { ...type.h4, letterSpacing: -0.3 },

  // Today's meals
  mealsGrid: { flexDirection: 'row', gap: 8 },
  mealSlot: {
    flex: 1, borderRadius: radius.md, borderWidth: 1,
    padding: 10, gap: 6, minHeight: 72,
  },
  mealTypePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
  },
  mealTypeText: { ...type.caption, fontWeight: '800', letterSpacing: 0.3 },
  mealName: { ...type.caption, fontWeight: '600', lineHeight: 15 },
  mealEmpty: { ...type.caption, fontStyle: 'italic' },

  // Low pantry
  lowItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lowItemDot: { width: 7, height: 7, borderRadius: 4 },
  lowItemName: { ...type.bodyMed, flex: 1, fontSize: 13 },
  lowItemQty: { ...type.caption },
  moreItems: { ...type.caption, paddingTop: 8, fontWeight: '600' },

  // Grocery
  groceryProgress: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  groceryProgressText: { ...type.caption, fontWeight: '600', minWidth: 50 },
  groceryItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groceryDot: {
    width: 16, height: 16, borderRadius: 4,
    borderWidth: 1.5,
  },
  groceryItemName: { ...type.bodyMed, flex: 1, fontSize: 13 },
  groceryItemQty: { ...type.caption },

  // Weekly Calendar
  calendarCount: { ...type.caption, fontWeight: '700' },
  dayTabsRow: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  dayTab: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: radius.full,
  },
  dayTabText: { ...type.caption, fontWeight: '700' },
  dayTabDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  calendarEmpty: { ...type.bodySm, paddingVertical: 10, fontStyle: 'italic' },
  todoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  todoText: { ...type.bodyMed, flex: 1, fontSize: 14 },
  todoDone: { textDecorationLine: 'line-through', opacity: 0.5 },
  todoAddRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  todoInput: { ...type.bodyMed, flex: 1, fontSize: 14, paddingVertical: 2 },
  addTodoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  addTodoBtnText: { ...type.caption, fontWeight: '700' },
});
