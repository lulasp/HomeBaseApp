import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, SafeAreaView, Platform, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAuth } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { useLightTimer } from '../../context/LightTimerContext';
import { Rise, useEntranceReplay } from '../../components/Motion';
import {
  getHouseholdWithPrivate, subscribeLightShortcuts,
  addLightShortcut, updateLightShortcut,
} from '../../services/firestore';
import {
  getDevices, getDeviceState, stateFromCapabilities,
  hasCap, getCapParam, getScenesFromDevice, getDynamicScenes, getDiyScenes,
  sceneKey, getSegmentCount,
  setPower, setBrightness, setColor, setColorTemp, applyScene, setMusicMode,
  setSegmentColor, setSegmentBrightness,
} from '../../services/govee';
import LightShortcutsRow, { SHORTCUT_VISUALS } from '../../components/LightShortcutsRow';

const PRESET_COLORS = [
  '#FFFFFF', '#FFD700', '#FF8C00', '#FF4500',
  '#FF1493', '#9400D3', '#0000FF', '#00BFFF',
  '#00FF7F', '#ADFF2F',
];

const MUSIC_MODES = [
  { id: 0, name: 'Energic',  icon: 'musical-notes' },
  { id: 1, name: 'Spectrum', icon: 'bar-chart' },
  { id: 2, name: 'Rolling',  icon: 'infinite' },
  { id: 3, name: 'Rhythm',   icon: 'pulse' },
];

// Cycled for scenes returned by the API
const SCENE_VISUALS = [
  { icon: 'sunny',        color: '#FFB347' },
  { icon: 'partly-sunny', color: '#FF6B35' },
  { icon: 'heart',        color: '#FF69B4' },
  { icon: 'flame',        color: '#FF8C00' },
  { icon: 'sparkles',     color: '#9B59B6' },
  { icon: 'snow',         color: '#87CEEB' },
  { icon: 'leaf',         color: '#7DB07A' },
  { icon: 'water',        color: '#1E90FF' },
  { icon: 'earth',        color: '#228B22' },
  { icon: 'flash',        color: '#FF00FF' },
];

const SCENE_SOURCES = [
  { id: 'static',  label: 'Featured' },
  { id: 'dynamic', label: 'Built-in' },
  { id: 'diy',     label: 'DIY' },
];

// The dynamic catalogue can run to hundreds of scenes — show a slice until the
// user searches or asks for the rest.
const SCENE_PAGE = 20;

const DEFAULT_SHORTCUT_FORM = {
  name: '',
  visual: 0,
  deviceIds: [],
  power: true,           // true | false | null (null = leave unchanged)
  brightnessEnabled: false,
  brightness: 80,
  colorMode: null,       // null | 'color' | 'colorTem' | 'scene'
  color: '#FFD700',
  colorTem: 4000,
  sceneName: null,
};

const DEFAULT_STATE = {
  on: false, brightness: 80, color: '#FFFFFF',
  colorTem: 4000, scene: null, musicMode: null, online: false,
};

function hasBluetooth(device) {
  return (device.capabilities ?? []).some((c) => c.type?.includes('bluetooth'));
}

// Reads live state for every device. Govee limits /device/state to 30 req/min
// *per device*, so one request each in parallel is safe. A device that errors
// out is treated as offline — its last reported values can't be trusted.
async function fetchDeviceStates(apiKey, devs) {
  const entries = await Promise.all(devs.map(async (dev) => {
    try {
      const caps = await getDeviceState(apiKey, dev.sku, dev.device);
      return [dev.device, stateFromCapabilities(caps)];
    } catch {
      return [dev.device, { ...DEFAULT_STATE, online: false }];
    }
  }));
  return Object.fromEntries(entries);
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function DeviceCard({ device, isSelected, isOn, isOnline, onSelect, onToggle }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const supportsBt = hasBluetooth(device);
  // An offline device reports stale values, so it can never read as "on".
  const lit = isOnline && isOn;
  return (
    <TouchableOpacity
      style={[styles.deviceCard, isSelected && styles.deviceCardSelected]}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`Select ${device.deviceName}${isOnline ? '' : ' (offline)'}`}
      accessibilityState={{ selected: isSelected }}
    >
      <View style={[
        styles.deviceIconWrap,
        lit && { backgroundColor: colors.accentSoft },
        isSelected && styles.deviceIconWrapSelected,
        !isOnline && styles.offline,
      ]}>
        <Ionicons
          name={lit ? 'bulb' : 'bulb-outline'}
          size={22}
          color={lit || isSelected ? colors.accent : colors.textTertiary}
        />
      </View>
      <View style={[{ flex: 1, marginLeft: 12 }, !isOnline && styles.offline]}>
        <Text style={[styles.deviceName, isSelected && styles.deviceNameSelected]} numberOfLines={1}>
          {device.deviceName}
        </Text>
        <View style={styles.deviceMeta}>
          <Text style={styles.deviceModel}>{device.sku}</Text>
          <View style={styles.connectivityIcons}>
            {isOnline ? (
              <Ionicons name="wifi" size={13} color={colors.success} />
            ) : (
              <>
                <Ionicons name="cloud-offline-outline" size={13} color={colors.textTertiary} />
                <Text style={styles.offlineLabel}>Offline</Text>
              </>
            )}
            {supportsBt && (
              <Ionicons
                name="bluetooth"
                size={13}
                color={colors.textTertiary}
              />
            )}
          </View>
        </View>
      </View>
      {isOnline ? (
        <Switch
          value={lit}
          onValueChange={onToggle}
          trackColor={{ false: colors.muted, true: colors.accent }}
          thumbColor="#fff"
          ios_backgroundColor={colors.muted}
          accessibilityLabel={`Toggle ${device.deviceName}`}
        />
      ) : (
        // A disabled Switch reads as a half-drawn control — show an inert
        // placeholder of the same width so rows stay aligned.
        <View style={styles.switchSlot}>
          <Text style={styles.switchSlotDash}>—</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HomeLightsScreen({ route }) {
  const { colors } = useTheme();
  const navScrollProps = useNavScrollProps();
  const { householdId } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const contentKey = useEntranceReplay();

  const { showAlert } = useAlert();

  const [goveeApiKey, setGoveeApiKey] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deviceStates, setDeviceStates] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // deviceId → { loading } | { dynamic: [], diy: [] }
  const [sceneCatalog, setSceneCatalog] = useState({});
  const [sceneSource, setSceneSource] = useState('all');
  const [sceneQuery, setSceneQuery] = useState('');
  const [scenesExpanded, setScenesExpanded] = useState(false);

  // Govee never reports per-segment colours back, so what we set is the only
  // record we have. Kept per device, in memory only.
  const [selectedSegments, setSelectedSegments] = useState([]);
  const [segmentColors, setSegmentColors] = useState({});
  const [segBrightness, setSegBrightness] = useState(100);

  const [shortcuts, setShortcuts] = useState([]);
  const [shortcutModalVisible, setShortcutModalVisible] = useState(false);
  const [editingShortcutId, setEditingShortcutId] = useState(null);
  const [shortcutForm, setShortcutForm] = useState(DEFAULT_SHORTCUT_FORM);
  const [savingShortcut, setSavingShortcut] = useState(false);

  const debounce = useRef({});

  useEffect(() => {
    if (!householdId) return undefined;
    return subscribeLightShortcuts(householdId, (data) =>
      setShortcuts(data.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))),
    );
  }, [householdId]);

  // ── Load devices + their current state on mount ───────────────────────────
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    async function load() {
      try {
        const hh = await getHouseholdWithPrivate(householdId);
        const apiKey = hh?.goveeApiKey ?? null;
        if (!cancelled) setGoveeApiKey(apiKey);
        if (!apiKey) { if (!cancelled) setLoading(false); return; }

        const devs = await getDevices(apiKey);
        if (cancelled) return;
        setDevices(devs);
        if (devs.length > 0) setSelectedId(devs[0].device);

        const states = await fetchDeviceStates(apiKey, devs);
        if (!cancelled) setDeviceStates(states);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [householdId]);

  // ── Keep state fresh: pull-to-refresh + on every re-focus ─────────────────
  const refreshStates = useCallback(async () => {
    if (!goveeApiKey || devices.length === 0) return;
    setRefreshing(true);
    try {
      setDeviceStates(await fetchDeviceStates(goveeApiKey, devices));
    } finally {
      setRefreshing(false);
    }
  }, [goveeApiKey, devices]);

  // Read through a ref so the focus effect keeps a stable identity — otherwise
  // it would re-fire every time `devices` settles, not just on re-focus.
  const refreshRef = useRef(refreshStates);
  refreshRef.current = refreshStates;
  const skipFocusRefresh = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (skipFocusRefresh.current) {
        skipFocusRefresh.current = false;   // mount already loads state
        return;
      }
      refreshRef.current();
    }, []),
  );

  useEffect(() => {
    const id = route?.params?.selectedDeviceId;
    if (id && devices.some((d) => d.device === id)) setSelectedId(id);
  }, [route?.params?.selectedDeviceId, devices]);

  // Overview's "New shortcut" card navigates here with this param
  useEffect(() => {
    if (route?.params?.createShortcut) openNewShortcut();
  }, [route?.params?.createShortcut]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedDevice = devices.find((d) => d.device === selectedId);
  const selected = deviceStates[selectedId] ?? DEFAULT_STATE;
  const selectedOnline = selected.online;
  const selectedOn = selectedOnline && selected.on;
  const onlineCount = devices.filter((d) => deviceStates[d.device]?.online).length;
  const offlineCount = devices.length - onlineCount;
  const onlineOnCount = devices.filter((d) => {
    const s = deviceStates[d.device];
    return s?.online && s?.on;
  }).length;

  const supports = useCallback((cap) => {
    if (!selectedDevice) return false;
    switch (cap) {
      case 'turn':       return hasCap(selectedDevice, 'devices.capabilities.on_off', 'powerSwitch');
      case 'brightness': return hasCap(selectedDevice, 'devices.capabilities.range', 'brightness');
      case 'color':      return hasCap(selectedDevice, 'devices.capabilities.color_setting', 'colorRgb');
      case 'colorTem':   return hasCap(selectedDevice, 'devices.capabilities.color_setting', 'colorTemperatureK');
      case 'musicMode':  return hasCap(selectedDevice, 'devices.capabilities.music_setting', 'musicMode');
      default:           return false;
    }
  }, [selectedDevice]);

  const colorTemParams = getCapParam(selectedDevice, 'devices.capabilities.color_setting', 'colorTemperatureK');
  const colorTemMin = colorTemParams?.range?.min ?? 2000;
  const colorTemMax = colorTemParams?.range?.max ?? 9000;

  const colorTemK = selected.colorTem;
  const colorTemLabel =
    colorTemK <= 3000 ? 'Warm' :
    colorTemK <= 4500 ? 'Neutral' :
    colorTemK <= 6000 ? 'Cool' : 'Daylight';

  const segmentCount = getSegmentCount(selectedDevice);

  // ── Scenes ────────────────────────────────────────────────────────────────
  // The device list only carries a handful of scenes; the full built-in
  // catalogue and the user's DIY scenes each need their own request. Fetched
  // once per device and cached — both endpoints allow 30 req/min per device.
  const sceneFetched = useRef({});
  useEffect(() => {
    if (!goveeApiKey || !selectedDevice) return;
    const id = selectedDevice.device;
    if (sceneFetched.current[id]) return;
    sceneFetched.current[id] = true;
    setSceneCatalog((prev) => ({ ...prev, [id]: { loading: true } }));
    (async () => {
      const [dynamic, diy] = await Promise.all([
        getDynamicScenes(goveeApiKey, selectedDevice.sku, id).catch(() => []),
        getDiyScenes(goveeApiKey, selectedDevice.sku, id).catch(() => []),
      ]);
      setSceneCatalog((prev) => ({ ...prev, [id]: { dynamic, diy } }));
    })();
  }, [goveeApiKey, selectedDevice]);

  // Reset the scene browser and segment selection when switching device
  useEffect(() => {
    setSceneSource('all');
    setSceneQuery('');
    setScenesExpanded(false);
    setSelectedSegments([]);
  }, [selectedId]);

  const allScenes = useMemo(() => {
    const featured = selectedDevice ? getScenesFromDevice(selectedDevice) : [];
    const cat = sceneCatalog[selectedId];
    const seen = new Set(featured.map((s) => s.name));
    const dynamic = (cat?.dynamic ?? []).filter((s) => !seen.has(s.name));
    return [...featured, ...dynamic, ...(cat?.diy ?? [])];
  }, [selectedDevice, sceneCatalog, selectedId]);

  const scenesLoading = Boolean(sceneCatalog[selectedId]?.loading);
  const sceneSources = SCENE_SOURCES.filter((s) => allScenes.some((sc) => sc.source === s.id));

  const visibleScenes = useMemo(() => {
    const q = sceneQuery.trim().toLowerCase();
    return allScenes.filter((s) =>
      (sceneSource === 'all' || s.source === sceneSource) &&
      (!q || s.name.toLowerCase().includes(q)));
  }, [allScenes, sceneSource, sceneQuery]);

  const shownScenes = scenesExpanded ? visibleScenes : visibleScenes.slice(0, SCENE_PAGE);

  // ── State helpers ─────────────────────────────────────────────────────────
  const updateSelected = useCallback((patch) => {
    setDeviceStates((prev) => ({
      ...prev,
      [selectedId]: { ...(prev[selectedId] ?? DEFAULT_STATE), ...patch },
    }));
  }, [selectedId]);

  // ── Control handlers (optimistic UI + API call) ───────────────────────────
  // Power is the one control we roll back on failure — the switch must never
  // claim a light is on when the command never reached it.
  const applyPower = useCallback((dev, next) => {
    const id = dev.device;
    setDeviceStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_STATE), on: next } }));
    setPower(goveeApiKey, dev.sku, id, next).catch((e) => {
      console.error(e);
      setDeviceStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_STATE), on: !next } }));
    });
  }, [goveeApiKey]);

  const toggleDevice = useCallback((id) => {
    const dev = devices.find((d) => d.device === id);
    const state = deviceStates[id];
    if (!dev || !goveeApiKey || !state?.online) return;
    applyPower(dev, !state.on);
  }, [devices, deviceStates, goveeApiKey, applyPower]);

  const handlePowerToggle = useCallback((v) => {
    if (!selectedDevice || !goveeApiKey || !selectedOnline) return;
    applyPower(selectedDevice, v);
  }, [selectedDevice, goveeApiKey, selectedOnline, applyPower]);

  // Every control is a no-op while the light is unreachable — nothing local
  // changes either, so the UI keeps showing the last known real state.
  const canControl = Boolean(selectedDevice) && Boolean(goveeApiKey) && selectedOnline;

  // Every light-emitting command (brightness, colour, temperature, scene,
  // music, segments) powers the device on as a side effect, so each one also
  // flips `on` locally — otherwise the toggle keeps reading off until the next
  // refresh even though the light is visibly lit.

  const handleBrightnessChange = useCallback((v) => {
    if (!canControl) return;
    const value = Math.round(v);
    updateSelected({ brightness: value, on: true });
    clearTimeout(debounce.current.brightness);
    debounce.current.brightness = setTimeout(() => {
      setBrightness(goveeApiKey, selectedDevice.sku, selectedDevice.device, value).catch(console.error);
    }, 300);
  }, [canControl, selectedDevice, updateSelected, goveeApiKey]);

  const handleColorChange = useCallback((hex) => {
    if (!canControl) return;
    updateSelected({ color: hex, scene: null, on: true });
    setColor(goveeApiKey, selectedDevice.sku, selectedDevice.device, hex).catch(console.error);
  }, [canControl, selectedDevice, updateSelected, goveeApiKey]);

  const handleColorTempChange = useCallback((v) => {
    if (!canControl) return;
    const value = Math.round(v);
    updateSelected({ colorTem: value, on: true });
    clearTimeout(debounce.current.colorTem);
    debounce.current.colorTem = setTimeout(() => {
      setColorTemp(goveeApiKey, selectedDevice.sku, selectedDevice.device, value).catch(console.error);
    }, 300);
  }, [canControl, selectedDevice, updateSelected, goveeApiKey]);

  const handleSceneSelect = useCallback((scene) => {
    if (!canControl) return;
    // Tapping the active scene clears it locally; there's no "no scene"
    // command, so nothing is sent — pick a colour to actually leave the scene.
    if (sceneKey(selected.scene) === scene.key) {
      updateSelected({ scene: null });
      return;
    }
    updateSelected({ scene: scene.value, on: true });
    applyScene(goveeApiKey, selectedDevice.sku, selectedDevice.device, scene).catch(console.error);
  }, [canControl, selectedDevice, selected.scene, updateSelected, goveeApiKey]);

  const toggleSegment = useCallback((seg) => {
    setSelectedSegments((prev) =>
      prev.includes(seg) ? prev.filter((s) => s !== seg) : [...prev, seg].sort((a, b) => a - b));
  }, []);

  const handleSegmentColor = useCallback((hex) => {
    if (!canControl || selectedSegments.length === 0) return;
    setSegmentColors((prev) => ({
      ...prev,
      [selectedId]: {
        ...(prev[selectedId] ?? {}),
        ...Object.fromEntries(selectedSegments.map((s) => [s, hex])),
      },
    }));
    updateSelected({ on: true });
    setSegmentColor(goveeApiKey, selectedDevice.sku, selectedDevice.device, selectedSegments, hex)
      .catch(console.error);
  }, [canControl, selectedSegments, selectedId, selectedDevice, updateSelected, goveeApiKey]);

  const handleSegmentBrightness = useCallback((v) => {
    const value = Math.round(v);
    setSegBrightness(value);
    if (!canControl || selectedSegments.length === 0) return;
    updateSelected({ on: true });
    clearTimeout(debounce.current.segment);
    debounce.current.segment = setTimeout(() => {
      setSegmentBrightness(goveeApiKey, selectedDevice.sku, selectedDevice.device, selectedSegments, value)
        .catch(console.error);
    }, 300);
  }, [canControl, selectedSegments, selectedDevice, updateSelected, goveeApiKey]);

  const handleMusicModeToggle = useCallback((v) => {
    if (!canControl) return;
    const next = v ? 0 : null;
    updateSelected(next === null ? { musicMode: null } : { musicMode: next, on: true });
    if (next !== null) setMusicMode(goveeApiKey, selectedDevice.sku, selectedDevice.device, next).catch(console.error);
  }, [canControl, selectedDevice, updateSelected, goveeApiKey]);

  const handleMusicModeSelect = useCallback((modeId) => {
    if (!canControl) return;
    updateSelected({ musicMode: modeId, on: true });
    setMusicMode(goveeApiKey, selectedDevice.sku, selectedDevice.device, modeId).catch(console.error);
  }, [canControl, selectedDevice, updateSelected, goveeApiKey]);

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  const handleShortcutPatch = useCallback((id, patch) => {
    setDeviceStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_STATE), ...patch } }));
  }, []);

  const openNewShortcut = useCallback(() => {
    setEditingShortcutId(null);
    setShortcutForm(DEFAULT_SHORTCUT_FORM);
    setShortcutModalVisible(true);
  }, []);

  const openEditShortcut = useCallback((shortcut) => {
    const a = shortcut.actions ?? {};
    setEditingShortcutId(shortcut.id);
    setShortcutForm({
      name: shortcut.name,
      visual: shortcut.visual ?? 0,
      deviceIds: shortcut.deviceIds ?? [],
      power: a.power ?? null,
      brightnessEnabled: a.brightness != null,
      brightness: a.brightness ?? 80,
      colorMode: a.colorMode ?? null,
      color: a.color ?? '#FFD700',
      colorTem: a.colorTem ?? 4000,
      sceneName: a.sceneName ?? null,
    });
    setShortcutModalVisible(true);
  }, []);

  const handleSaveShortcut = useCallback(async () => {
    const name = shortcutForm.name.trim();
    if (!name) {
      showAlert({ title: 'Name required', message: 'Give your shortcut a name.', type: 'warning' });
      return;
    }
    if (shortcutForm.deviceIds.length === 0) {
      showAlert({ title: 'No lights selected', message: 'Pick at least one light to include.', type: 'warning' });
      return;
    }
    const doc = {
      name,
      visual: shortcutForm.visual,
      deviceIds: shortcutForm.deviceIds,
      actions: {
        power: shortcutForm.power,
        brightness: shortcutForm.brightnessEnabled ? shortcutForm.brightness : null,
        colorMode: shortcutForm.colorMode,
        color: shortcutForm.color,
        colorTem: shortcutForm.colorTem,
        sceneName: shortcutForm.sceneName,
      },
    };
    setSavingShortcut(true);
    try {
      if (editingShortcutId) await updateLightShortcut(householdId, editingShortcutId, doc);
      else await addLightShortcut(householdId, doc);
      setShortcutModalVisible(false);
    } catch (e) {
      showAlert({ title: 'Could not save', message: e.message, type: 'error' });
    } finally {
      setSavingShortcut(false);
    }
  }, [shortcutForm, editingShortcutId, householdId, showAlert]);

  const toggleFormDevice = useCallback((id) => {
    setShortcutForm((f) => ({
      ...f,
      deviceIds: f.deviceIds.includes(id)
        ? f.deviceIds.filter((d) => d !== id)
        : [...f.deviceIds, id],
    }));
  }, []);

  // Scene names available across the lights picked in the form (union — each
  // device resolves the name to its own scene value when the shortcut runs)
  const formSceneNames = useMemo(() => {
    const names = new Set();
    for (const id of shortcutForm.deviceIds) {
      const dev = devices.find((d) => d.device === id);
      for (const s of getScenesFromDevice(dev)) names.add(s.name);
      // Catalogue scenes are only listed for devices already browsed this
      // session; the shortcut still resolves any name at run time.
      const cat = sceneCatalog[id];
      for (const s of [...(cat?.dynamic ?? []), ...(cat?.diy ?? [])]) names.add(s.name);
    }
    return [...names];
  }, [shortcutForm.deviceIds, devices, sceneCatalog]);

  const { startTimer, cancelTimer, activeTimers } = useLightTimer();

  const innerStyle = isDesktop
    ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }
    : undefined;

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.subtitle, { marginTop: 12 }]}>Loading devices…</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.title, { marginTop: 16, textAlign: 'center' }]}>Could not load devices</Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8 }]}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (!goveeApiKey) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Ionicons name="key-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.title, { marginTop: 16, textAlign: 'center' }]}>No Govee API key</Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8 }]}>
          Add your Govee API key in Household Settings to control your lights.
        </Text>
      </SafeAreaView>
    );
  }

  if (devices.length === 0) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Ionicons name="bulb-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.title, { marginTop: 16, textAlign: 'center' }]}>No devices found</Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8 }]}>
          Make sure your Govee devices are linked to your account.
        </Text>
      </SafeAreaView>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.root, Platform.OS === 'android' && { paddingTop: 24 }]}>
      <ScrollView
        key={contentKey}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, innerStyle]}
        {...navScrollProps}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshStates} tintColor={colors.accent} />
        }
      >
        {/* Header */}
        <Rise index={0}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Home Lights</Text>
            <Text style={styles.subtitle}>
              {onlineOnCount} of {onlineCount} online lights on
              {offlineCount > 0 ? ` · ${offlineCount} offline` : ''}
            </Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="wifi" size={13} color={colors.accent} />
            <Text style={styles.headerBadgeText}>Govee</Text>
          </View>
        </View>
        </Rise>

        {/* Shortcuts */}
        <Rise index={1}>
        <View style={styles.sectionLabelRow}>
          <Text style={[styles.sectionLabel, styles.sectionLabelFlat]}>SHORTCUTS</Text>
        </View>
        <LightShortcutsRow
          householdId={householdId}
          apiKey={goveeApiKey}
          devices={devices}
          shortcuts={shortcuts}
          onDevicePatch={handleShortcutPatch}
          onCreateNew={openNewShortcut}
          onEdit={openEditShortcut}
        />
        </Rise>

        {/* Devices */}
        <Rise index={2}>
        <View style={styles.sectionLabelRow}>
          <Text style={[styles.sectionLabel, styles.sectionLabelFlat]}>DEVICES</Text>
          {onlineOnCount > 0 && (
            <View style={styles.activeBadge}>
              <View style={styles.activeDot} />
              <Text style={styles.activeBadgeText}>{onlineOnCount} on</Text>
            </View>
          )}
          {offlineCount > 0 && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>{offlineCount} offline</Text>
            </View>
          )}
        </View>
        <View style={styles.card}>
          {devices.map((device, i) => (
            <React.Fragment key={device.device}>
              <DeviceCard
                device={device}
                isSelected={device.device === selectedId}
                isOn={deviceStates[device.device]?.on ?? false}
                isOnline={deviceStates[device.device]?.online ?? false}
                onSelect={() => setSelectedId(device.device)}
                onToggle={() => toggleDevice(device.device)}
              />
              {i < devices.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
          ))}
        </View>
        </Rise>

        {/* Controls header */}
        <View style={styles.controlsHeader}>
          <Text style={styles.sectionLabel}>CONTROLS</Text>
          <Text style={styles.selectedDeviceLabel}>{selectedDevice?.deviceName}</Text>
        </View>

        {selectedDevice && !selectedOnline && (
          <View style={styles.offlineNotice}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.offlineNoticeText}>
              This light is offline — controls are unavailable. Pull down to refresh.
            </Text>
          </View>
        )}

        {/* Power + Brightness */}
        <View style={[styles.card, !selectedOnline && styles.offline]}>
          <View style={styles.controlRow}>
            <View style={styles.controlRowLeft}>
              <View style={[styles.controlIcon, selectedOn && styles.controlIconActive]}>
                <Ionicons
                  name={selectedOn ? 'power' : 'power-outline'}
                  size={18}
                  color={selectedOn ? colors.accent : colors.textTertiary}
                />
              </View>
              <View>
                <Text style={styles.controlLabel}>Power</Text>
                <Text style={styles.controlValue}>
                  {!selectedOnline ? 'Offline' : selected.on ? 'On' : 'Off'}
                </Text>
              </View>
            </View>
            {selectedOnline ? (
              <Switch
                value={selectedOn}
                onValueChange={handlePowerToggle}
                trackColor={{ false: colors.muted, true: colors.accent }}
                thumbColor="#fff"
                ios_backgroundColor={colors.muted}
              />
            ) : (
              <View style={styles.switchSlot}>
                <Text style={styles.switchSlotDash}>—</Text>
              </View>
            )}
          </View>

          {supports('brightness') && (
            <>
              <View style={styles.divider} />
              <View style={styles.controlCol}>
                <View style={[styles.controlRowLeft, { justifyContent: 'space-between' }]}>
                  <View style={styles.controlRowLeft}>
                    <View style={styles.controlIcon}>
                      <Ionicons name="sunny-outline" size={18} color={colors.textSecondary} />
                    </View>
                    <Text style={styles.controlLabel}>Brightness</Text>
                  </View>
                  <Text style={styles.sliderValue}>{selected.brightness}%</Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={1}
                  maximumValue={100}
                  step={1}
                  value={selected.brightness}
                  onValueChange={handleBrightnessChange}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.muted}
                  thumbTintColor={colors.accent}
                  disabled={!selectedOnline}
                  accessibilityLabel="Brightness slider"
                />
              </View>
            </>
          )}
        </View>

        {/* Color */}
        {supports('color') && (
          <>
            <Text style={styles.sectionLabel}>COLOR</Text>
            <View style={[styles.card, !selectedOnline && styles.offline]}>
              <View style={[styles.colorPreview, { backgroundColor: selected.color }]}>
                <Text style={[styles.colorHex, { color: selected.color === '#FFFFFF' ? '#333' : '#fff' }]}>
                  {selected.color}
                </Text>
              </View>
              <View style={styles.colorGrid}>
                {PRESET_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: c },
                      selected.color === c && styles.colorSwatchSelected,
                    ]}
                    onPress={() => handleColorChange(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select color ${c}`}
                  />
                ))}
              </View>
            </View>
          </>
        )}

        {/* Color Temperature */}
        {supports('colorTem') && (
          <>
            <Text style={styles.sectionLabel}>COLOR TEMPERATURE</Text>
            <View style={[styles.card, !selectedOnline && styles.offline]}>
              <View style={styles.controlCol}>
                <View style={styles.controlRowLeft}>
                  <View style={styles.controlIcon}>
                    <Ionicons name="thermometer-outline" size={18} color={colors.textSecondary} />
                  </View>
                  <View>
                    <Text style={styles.controlLabel}>{colorTemLabel}</Text>
                    <Text style={styles.controlValue}>{colorTemK}K</Text>
                  </View>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={colorTemMin}
                  maximumValue={colorTemMax}
                  step={100}
                  value={Math.min(Math.max(colorTemK, colorTemMin), colorTemMax)}
                  onValueChange={handleColorTempChange}
                  minimumTrackTintColor="#FFD580"
                  maximumTrackTintColor={colors.muted}
                  thumbTintColor="#FFD580"
                  disabled={!selectedOnline}
                  accessibilityLabel="Color temperature slider"
                />
                <View style={styles.colorTemRow}>
                  <Text style={styles.colorTemHint}>Warm ({colorTemMin}K)</Text>
                  <Text style={styles.colorTemHint}>Cool ({colorTemMax}K)</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Scenes — device's own list plus the built-in and DIY catalogues */}
        {(allScenes.length > 0 || scenesLoading) && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>SCENES</Text>
              {scenesLoading && <ActivityIndicator size="small" color={colors.accent} />}
            </View>

            {sceneSources.length > 1 && (
              <View style={styles.chipRow}>
                {[{ id: 'all', label: 'All' }, ...sceneSources].map((src) => {
                  const active = sceneSource === src.id;
                  return (
                    <TouchableOpacity
                      key={src.id}
                      style={[styles.sceneChip, active && styles.sceneChipActive]}
                      onPress={() => { setSceneSource(src.id); setScenesExpanded(false); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.sceneChipLabel, active && { color: colors.accent }]}>
                        {src.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {allScenes.length > SCENE_PAGE && (
              <TextInput
                style={styles.sceneSearch}
                value={sceneQuery}
                onChangeText={setSceneQuery}
                placeholder="Search scenes…"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
                accessibilityLabel="Search scenes"
              />
            )}

            <View style={[styles.scenesGrid, !selectedOnline && styles.offline]}>
              {shownScenes.map((scene, i) => {
                const active = sceneKey(selected.scene) === scene.key;
                const visual = SCENE_VISUALS[i % SCENE_VISUALS.length];
                return (
                  <TouchableOpacity
                    key={`${scene.source}-${scene.key}`}
                    style={[styles.sceneCard, active && styles.sceneCardActive]}
                    onPress={() => handleSceneSelect(scene)}
                    accessibilityRole="button"
                    accessibilityLabel={`${scene.name} scene`}
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.sceneIcon, { backgroundColor: visual.color + '33' }]}>
                      <Ionicons
                        name={scene.source === 'diy' ? 'color-wand' : visual.icon}
                        size={20}
                        color={visual.color}
                      />
                    </View>
                    <Text
                      style={[styles.sceneName, active && { color: colors.accent }]}
                      numberOfLines={1}
                    >
                      {scene.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {visibleScenes.length > shownScenes.length && (
              <TouchableOpacity
                style={styles.showAllBtn}
                onPress={() => setScenesExpanded(true)}
                accessibilityRole="button"
              >
                <Text style={styles.showAllLabel}>Show all {visibleScenes.length}</Text>
              </TouchableOpacity>
            )}

            {visibleScenes.length === 0 && !scenesLoading && (
              <Text style={styles.timerHint}>No scenes match “{sceneQuery}”</Text>
            )}
          </>
        )}

        {/* Music Mode */}
        {supports('musicMode') && (
          <>
            <Text style={styles.sectionLabel}>MUSIC MODE</Text>
            <View style={[styles.card, !selectedOnline && styles.offline]}>
              <View style={styles.musicHeader}>
                <View style={styles.controlRowLeft}>
                  <View style={[styles.controlIcon, selected.musicMode !== null && styles.controlIconActive]}>
                    <Ionicons
                      name="musical-notes"
                      size={18}
                      color={selected.musicMode !== null ? colors.accent : colors.textTertiary}
                    />
                  </View>
                  <Text style={styles.controlLabel}>Sync to Music</Text>
                </View>
                <Switch
                  value={selected.musicMode !== null}
                  onValueChange={handleMusicModeToggle}
                  trackColor={{ false: colors.muted, true: colors.accent }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.muted}
                />
              </View>
              {selected.musicMode !== null && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.musicModes}>
                    {MUSIC_MODES.map((mode) => {
                      const active = selected.musicMode === mode.id;
                      return (
                        <TouchableOpacity
                          key={mode.id}
                          style={[styles.musicModeBtn, active && styles.musicModeBtnActive]}
                          onPress={() => handleMusicModeSelect(mode.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`${mode.name} music mode`}
                        >
                          <Ionicons name={mode.icon} size={16} color={active ? colors.accent : colors.textTertiary} />
                          <Text style={[styles.musicModeLabel, active && { color: colors.accent }]}>
                            {mode.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </>
        )}

        {/* Segment Control */}
        {segmentCount > 0 && (
          <>
            <Text style={styles.sectionLabel}>SEGMENT CONTROL</Text>
            <View style={[styles.card, !selectedOnline && styles.offline]}>
              <View style={styles.segmentHeader}>
                <Text style={styles.controlLabel}>
                  {selectedSegments.length > 0
                    ? `${selectedSegments.length} of ${segmentCount} selected`
                    : 'Tap segments to select'}
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedSegments(
                    selectedSegments.length === segmentCount
                      ? []
                      : Array.from({ length: segmentCount }, (_, i) => i),
                  )}
                  accessibilityRole="button"
                >
                  <Text style={styles.segmentAction}>
                    {selectedSegments.length === segmentCount ? 'Clear' : 'Select all'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.segmentRow}>
                {Array.from({ length: segmentCount }, (_, seg) => {
                  const active = selectedSegments.includes(seg);
                  const segColor = segmentColors[selectedId]?.[seg];
                  return (
                    <TouchableOpacity
                      key={seg}
                      style={[
                        styles.segment,
                        segColor ? { backgroundColor: segColor } : null,
                        active && styles.segmentActive,
                      ]}
                      onPress={() => toggleSegment(seg)}
                      accessibilityRole="button"
                      accessibilityLabel={`Segment ${seg + 1}`}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.segmentLabel, !segColor && { color: colors.textTertiary }]}>
                        {seg + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.divider} />

              <Text style={styles.controlLabel}>Colour</Text>
              <View style={styles.colorGrid}>
                {PRESET_COLORS.map((hex) => (
                  <TouchableOpacity
                    key={hex}
                    style={[styles.colorSwatch, { backgroundColor: hex }]}
                    onPress={() => handleSegmentColor(hex)}
                    disabled={selectedSegments.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Set selected segments to ${hex}`}
                  />
                ))}
              </View>

              <View style={styles.divider} />

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Brightness</Text>
                <Text style={styles.colorHex}>{segBrightness}%</Text>
              </View>
              <Slider
                minimumValue={1}
                maximumValue={100}
                value={segBrightness}
                onValueChange={handleSegmentBrightness}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.muted}
                thumbTintColor={colors.accent}
                disabled={selectedSegments.length === 0}
              />

              {selectedSegments.length === 0 && (
                <Text style={styles.timerHint}>Select one or more segments to change them</Text>
              )}
            </View>
          </>
        )}

        {/* Timer */}
        {selectedDevice && (
          <>
            <Text style={styles.sectionLabel}>TIMER</Text>
            <View style={[styles.card, !selectedOnline && styles.offline]}>
              <View style={styles.timerRow}>
                {['15 min', '30 min', '1 hr', '2 hr'].map((label) => {
                  const active = activeTimers[selectedDevice.device]?.label === label;
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.timerBtn, active && styles.timerBtnActive]}
                      onPress={() => {
                        if (active) {
                          cancelTimer(selectedDevice.device);
                        } else {
                          startTimer(selectedDevice.device, selectedDevice.deviceName, label);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set timer for ${label}`}
                      accessibilityState={{ selected: active }}
                    >
                      <Ionicons
                        name={active ? 'timer' : 'timer-outline'}
                        size={14}
                        color={active ? colors.accent : colors.textSecondary}
                      />
                      <Text style={[styles.timerBtnLabel, active && styles.timerBtnLabelActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.timerHint}>
                {activeTimers[selectedDevice.device]
                  ? `Auto-off in ${activeTimers[selectedDevice.device].label} · tap again to cancel`
                  : 'Tap to schedule auto-off'}
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Create / Edit shortcut modal */}
      <Modal
        visible={shortcutModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setShortcutModalVisible(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setShortcutModalVisible(false)}
            activeOpacity={1}
          />

          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {editingShortcutId ? 'Edit Shortcut' : 'New Shortcut'}
              </Text>
              <TouchableOpacity
                onPress={() => setShortcutModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Movie Night"
                placeholderTextColor={colors.textTertiary}
                value={shortcutForm.name}
                onChangeText={(v) => setShortcutForm((f) => ({ ...f, name: v }))}
              />

              <Text style={styles.fieldLabel}>Icon</Text>
              <View style={styles.visualRow}>
                {SHORTCUT_VISUALS.map((visual, i) => (
                  <TouchableOpacity
                    key={visual.icon}
                    style={[
                      styles.visualBtn,
                      { backgroundColor: visual.color + '33' },
                      shortcutForm.visual === i && { borderColor: visual.color },
                    ]}
                    onPress={() => setShortcutForm((f) => ({ ...f, visual: i }))}
                    accessibilityRole="button"
                    accessibilityLabel={`${visual.icon} icon`}
                  >
                    <Ionicons name={visual.icon} size={18} color={visual.color} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Lights *</Text>
              {devices.map((device) => {
                const included = shortcutForm.deviceIds.includes(device.device);
                return (
                  <TouchableOpacity
                    key={device.device}
                    style={[styles.pickRow, included && styles.pickRowSelected]}
                    onPress={() => toggleFormDevice(device.device)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: included }}
                    accessibilityLabel={`Include ${device.deviceName}`}
                  >
                    <Ionicons
                      name={included ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={included ? colors.accent : colors.textTertiary}
                    />
                    <Text style={[styles.pickRowLabel, included && { color: colors.accent }]} numberOfLines={1}>
                      {device.deviceName}
                    </Text>
                    <Text style={styles.deviceModel}>{device.sku}</Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={styles.fieldLabel}>Power</Text>
              <View style={styles.segmentedRow}>
                {[
                  { label: 'Turn on', value: true },
                  { label: 'Turn off', value: false },
                  { label: 'No change', value: null },
                ].map((opt) => {
                  const active = shortcutForm.power === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={[styles.segmentedBtn, active && styles.segmentedBtnActive]}
                      onPress={() => setShortcutForm((f) => ({ ...f, power: opt.value }))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.segmentedLabel, active && { color: colors.accent }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {shortcutForm.power !== false && (
                <>
                  <View style={styles.formToggleRow}>
                    <Text style={styles.fieldLabel}>Set brightness</Text>
                    <Switch
                      value={shortcutForm.brightnessEnabled}
                      onValueChange={(v) => setShortcutForm((f) => ({ ...f, brightnessEnabled: v }))}
                      trackColor={{ false: colors.muted, true: colors.accent }}
                      thumbColor="#fff"
                      ios_backgroundColor={colors.muted}
                    />
                  </View>
                  {shortcutForm.brightnessEnabled && (
                    <View>
                      <Text style={styles.sliderValue}>{shortcutForm.brightness}%</Text>
                      <Slider
                        style={styles.slider}
                        minimumValue={1}
                        maximumValue={100}
                        step={1}
                        value={shortcutForm.brightness}
                        onValueChange={(v) => setShortcutForm((f) => ({ ...f, brightness: Math.round(v) }))}
                        minimumTrackTintColor={colors.accent}
                        maximumTrackTintColor={colors.muted}
                        thumbTintColor={colors.accent}
                        accessibilityLabel="Shortcut brightness slider"
                      />
                    </View>
                  )}

                  <Text style={styles.fieldLabel}>Color</Text>
                  <View style={styles.segmentedRow}>
                    {[
                      { label: 'No change', value: null },
                      { label: 'Color', value: 'color' },
                      { label: 'White', value: 'colorTem' },
                      { label: 'Scene', value: 'scene' },
                    ].map((opt) => {
                      const active = shortcutForm.colorMode === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.label}
                          style={[styles.segmentedBtn, active && styles.segmentedBtnActive]}
                          onPress={() => setShortcutForm((f) => ({ ...f, colorMode: opt.value }))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.segmentedLabel, active && { color: colors.accent }]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {shortcutForm.colorMode === 'color' && (
                    <View style={styles.colorGrid}>
                      {PRESET_COLORS.map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[
                            styles.colorSwatch,
                            { backgroundColor: c },
                            shortcutForm.color === c && styles.colorSwatchSelected,
                          ]}
                          onPress={() => setShortcutForm((f) => ({ ...f, color: c }))}
                          accessibilityRole="button"
                          accessibilityLabel={`Select color ${c}`}
                        />
                      ))}
                    </View>
                  )}

                  {shortcutForm.colorMode === 'colorTem' && (
                    <View>
                      <Text style={styles.sliderValue}>{shortcutForm.colorTem}K</Text>
                      <Slider
                        style={styles.slider}
                        minimumValue={2000}
                        maximumValue={9000}
                        step={100}
                        value={shortcutForm.colorTem}
                        onValueChange={(v) => setShortcutForm((f) => ({ ...f, colorTem: Math.round(v) }))}
                        minimumTrackTintColor="#FFD580"
                        maximumTrackTintColor={colors.muted}
                        thumbTintColor="#FFD580"
                        accessibilityLabel="Shortcut color temperature slider"
                      />
                    </View>
                  )}

                  {shortcutForm.colorMode === 'scene' && (
                    formSceneNames.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.sceneChipRow}
                      >
                        {formSceneNames.map((name) => {
                          const active = shortcutForm.sceneName === name;
                          return (
                            <TouchableOpacity
                              key={name}
                              style={[styles.sceneChip, active && styles.sceneChipActive]}
                              onPress={() => setShortcutForm((f) => ({ ...f, sceneName: name }))}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                            >
                              <Text style={[styles.sceneChipLabel, active && { color: colors.accent }]}>
                                {name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={styles.timerHint}>
                        {shortcutForm.deviceIds.length === 0
                          ? 'Select lights above to see their scenes'
                          : 'The selected lights have no scenes'}
                      </Text>
                    )
                  )}
                </>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.accent }, savingShortcut && { opacity: 0.6 }]}
                onPress={handleSaveShortcut}
                disabled={savingShortcut}
                accessibilityRole="button"
                accessibilityLabel="Save shortcut"
              >
                <Text style={styles.saveBtnLabel}>
                  {savingShortcut ? 'Saving…' : editingShortcutId ? 'Save Changes' : 'Create Shortcut'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: spacing.xxl,
  },
  title:    { ...type.h2, color: colors.textPrimary, marginBottom: 4 },
  subtitle: { ...type.body, color: colors.textTertiary },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
  },
  headerBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },

  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...type.label, color: colors.textTertiary,
    marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  sectionLabelFlat: { marginTop: 0, marginBottom: 0 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  activeBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },
  offlineBadge: {
    backgroundColor: colors.muted,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
  },
  offlineBadgeText: { ...type.caption, color: colors.textTertiary, fontWeight: '700' },

  offline: { opacity: 0.5 },
  offlineLabel: { ...type.caption, color: colors.textTertiary, fontWeight: '700' },
  switchSlot: { width: 51, alignItems: 'center', justifyContent: 'center' },
  switchSlotDash: { ...type.body, color: colors.textTertiary },
  offlineNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  offlineNoticeText: { ...type.caption, color: colors.textSecondary, flex: 1 },

  controlsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  selectedDeviceLabel: { ...type.caption, color: colors.accent },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: 2,
  },

  deviceCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  deviceCardSelected: { backgroundColor: colors.accentSoft },
  deviceIconWrap: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  deviceIconWrapSelected: { backgroundColor: colors.accentSoft },
  deviceName:         { ...type.bodyMed, color: colors.textPrimary },
  deviceNameSelected: { color: colors.accent },
  deviceMeta:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  deviceModel:        { ...type.caption, color: colors.textTertiary },
  connectivityIcons:  { flexDirection: 'row', alignItems: 'center', gap: 4 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  controlRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlCol:    { gap: 0 },
  slider:        { width: '100%', height: 40, marginTop: 4 },
  sliderValue:   { ...type.bodyMed, color: colors.accent, fontSize: 14 },
  controlRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlIcon: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  controlIconActive: { backgroundColor: colors.accentSoft },
  controlLabel: { ...type.bodyMed, color: colors.textPrimary },
  controlValue: { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  colorPreview: {
    height: 52, borderRadius: radius.md,
    marginBottom: spacing.md,
    alignItems: 'center', justifyContent: 'center',
  },
  colorHex:  { ...type.label, fontWeight: '700' },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: {
    width: 36, height: 36, borderRadius: radius.full,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorSwatchSelected: { borderColor: colors.accent },

  colorTemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  colorTemHint: { ...type.caption, color: colors.textTertiary },

  scenesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 2 },
  sceneCard: {
    width: '18%', minWidth: 60,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center', gap: 6,
  },
  sceneCardActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sceneIcon: {
    width: 40, height: 40, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  sceneName: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  sceneSearch: {
    ...type.body, color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  showAllBtn: { alignSelf: 'center', paddingVertical: spacing.sm },
  showAllLabel: { ...type.caption, color: colors.accent, fontWeight: '700' },

  musicHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  musicModes:  { flexDirection: 'row', gap: 8, marginTop: 4 },
  musicModeBtn: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10,
    backgroundColor: colors.muted, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  musicModeBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  musicModeLabel: { ...type.caption, color: colors.textTertiary },

  timerRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  timerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10,
    backgroundColor: colors.muted, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  timerBtnActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  timerBtnLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  timerBtnLabelActive: { color: colors.accent },
  timerHint: { ...type.caption, color: colors.textTertiary, textAlign: 'center', marginTop: 4 },

  segmentHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  segmentAction: { ...type.caption, color: colors.accent, fontWeight: '700' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  segment: {
    width: 40, height: 40, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.muted,
    borderWidth: 2, borderColor: 'transparent',
  },
  segmentActive: { borderColor: colors.accent },
  segmentLabel: { ...type.caption, color: '#fff', fontWeight: '700' },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  handleRow:   { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  handle:      { width: 36, height: 4, borderRadius: 2 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetTitle: { ...type.h4, color: colors.textPrimary },
  sheetBody:  {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },

  fieldLabel: { ...type.label, color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    height: 50, backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
  },

  visualRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  visualBtn: {
    width: 40, height: 40, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  pickRowSelected: { backgroundColor: colors.accentSoft },
  pickRowLabel: { ...type.bodyMed, color: colors.textPrimary, flex: 1 },

  segmentedRow: { flexDirection: 'row', gap: 8 },
  segmentedBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    backgroundColor: colors.muted, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  segmentedBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  segmentedLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },

  formToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },

  sceneChipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  sceneChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    backgroundColor: colors.muted, borderRadius: radius.full,
    borderWidth: 1, borderColor: 'transparent',
  },
  sceneChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sceneChipLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },

  saveBtn: {
    height: 52, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.lg,
  },
  saveBtnLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },
});
