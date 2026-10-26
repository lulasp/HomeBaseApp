import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, SafeAreaView, Platform, ActivityIndicator,
  TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAuth } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { getHouseholdWithPrivate, updateHouseholdXiaomiCreds } from '../../services/firestore';
import { Rise, useEntranceReplay } from '../../components/Motion';
import {
  getCredentials, saveCredentials, hasCredentials, syncCredentialsFromHousehold,
  getDevices, getDeviceType, getFanSpec, getHeaterSpec, clampTargetTemp,
  fanStateFromProps, heaterStateFromProps, vacuumStateFromProps,
  getFanState, setFanPower, setFanLevel, setFanMode, setFanOscillation,
  setFanTimer, setFanChildLock, setFanDisplay, setFanBeep,
  getHeaterState, setHeaterPower, setHeaterTargetTemp, setHeaterMode,
  setHeaterOscillation, setHeaterCountdown, setHeaterChildLock, setHeaterDisplay, setHeaterBeep,
  getVacuumState, startCleaning, pauseCleaning, resumeCleaning, returnToDock,
  findVacuum, setVacuumSuction, resetVacuumPart,
} from '../../services/xiaomi';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { childLock: false, display: true, beep: true };
const DEFAULT_FAN     = { on: false, level: 1, mode: 0, oscillate: false, speed: 25, timer: 0, ...DEFAULT_SETTINGS };
const DEFAULT_HEATER  = {
  on: false, fault: 0, targetTemp: null, temperature: null, mode: 0, countdown: 0, oscillate: false, ...DEFAULT_SETTINGS,
};
const DEFAULT_VACUUM  = { status: 'idle', error: 0, suction: 1, battery: 100, cleanArea: null, cleanTime: null, parts: [] };

const FAN_LEVELS = [1, 2, 3, 4];

const FAN_MODES = [
  { id: 0, label: 'Normal', icon: 'thermometer-outline' },
  { id: 1, label: 'Nature', icon: 'leaf-outline'        },
  { id: 2, label: 'Sleep',  icon: 'moon-outline'        },
];

const HEATER_MODES = [
  { id: 0, label: 'Constant', icon: 'thermometer-outline' },
  { id: 1, label: 'Heat',     icon: 'flame-outline'       },
  { id: 2, label: 'Warm',     icon: 'sunny-outline'       },
  { id: 3, label: 'Fan',      icon: 'leaf-outline'        },
];

const HEATER_FAULTS = {
  1: 'Room too cold',
  2: 'Room too hot',
  3: 'Plug too cold',
  4: 'Plug too hot',
};

// Off-timer presets, minutes (device max 480)
const TIMER_PRESETS = [
  { minutes: 0,   label: 'Off' },
  { minutes: 60,  label: '1h'  },
  { minutes: 120, label: '2h'  },
  { minutes: 240, label: '4h'  },
  { minutes: 480, label: '8h'  },
];

// Shown only for keys the model's spec supports.
const DEVICE_SETTINGS = [
  { key: 'childLock', label: 'Child lock', on: 'lock-closed',  off: 'lock-open-outline' },
  { key: 'display',   label: 'Display',    on: 'bulb',         off: 'bulb-outline'      },
  { key: 'beep',      label: 'Beep',       on: 'volume-high',  off: 'volume-mute-outline' },
];

const FAN_SETTERS    = { timer: setFanTimer, childLock: setFanChildLock, display: setFanDisplay, beep: setFanBeep };
const HEATER_SETTERS = { childLock: setHeaterChildLock, display: setHeaterDisplay, beep: setHeaterBeep };

const TEMP_DEBOUNCE_MS = 500;

const formatCountdown = (min) =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ''}`.trim() : `${min}m`;

const SUCTION_LEVELS = [
  { id: 0, label: 'Quiet',    icon: 'volume-low-outline'    },
  { id: 1, label: 'Standard', icon: 'volume-medium-outline' },
  { id: 2, label: 'Turbo',    icon: 'volume-high-outline'   },
  { id: 3, label: 'Max',      icon: 'flash-outline'         },
];

// Keyed by part key from the vacuum spec.
const VACUUM_PARTS = {
  mainBrush: { label: 'Main brush', icon: 'sync-outline'   },
  sideBrush: { label: 'Side brush', icon: 'flower-outline' },
  filter:    { label: 'Filter',     icon: 'funnel-outline' },
  mop:       { label: 'Mop pads',   icon: 'water-outline'  },
  dustBag:   { label: 'Dust bag',   icon: 'trash-outline'  },
  detergent: { label: 'Detergent',  icon: 'flask-outline'  },
};

const partColor = (life, colors) => (life <= 10 ? colors.danger : life <= 25 ? colors.warning : colors.sage);

// Keyed by the normalised status from vacuumStateFromProps; color is a theme token.
const VACUUM_STATUS_MAP = {
  cleaning:  { label: 'Cleaning',  icon: 'refresh',          color: 'sage'         },
  idle:      { label: 'Idle',      icon: 'ellipse-outline',  color: 'textTertiary' },
  paused:    { label: 'Paused',    icon: 'pause-circle',     color: 'amber'        },
  charging:  { label: 'Charging',  icon: 'battery-charging', color: 'accent'       },
  charged:   { label: 'Charged',   icon: 'battery-full',     color: 'success'      },
  returning: { label: 'Returning', icon: 'home',             color: 'accent'       },
  washing:   { label: 'Washing',   icon: 'water-outline',    color: 'accent'       },
  mapping:   { label: 'Mapping',   icon: 'map-outline',      color: 'accent'       },
  updating:  { label: 'Updating',  icon: 'cloud-download',   color: 'warning'      },
  remote:    { label: 'Remote',    icon: 'game-controller',  color: 'accent'       },
  error:     { label: 'Error',     icon: 'alert-circle',     color: 'danger'       },
};

const REGIONS = [
  { key: 'cn', label: 'China'         },
  { key: 'us', label: 'United States' },
  { key: 'eu', label: 'Europe'        },
  { key: 'ru', label: 'Russia'        },
  { key: 'sg', label: 'Singapore'     },
  { key: 'in', label: 'India'         },
  { key: 'de', label: 'Germany'       },
  { key: 'tw', label: 'Taiwan'        },
];

// ── CredentialsModal ──────────────────────────────────────────────────────────

function CredentialsModal({ visible, onClose, onSaved, colors, householdId }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [form, setForm] = useState({ userId: '', serviceToken: '', ssecurity: '', region: 'cn' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      getCredentials().then(setForm);
    }
  }, [visible]);

  const set = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.userId || !form.serviceToken || !form.ssecurity) return;
    setSaving(true);
    try {
      await saveCredentials(form);
      // Share with the household so other devices/members pick them up.
      if (householdId) await updateHouseholdXiaomiCreds(householdId, form).catch(() => {});
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%', alignItems: 'center' }}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Mi Home Setup</Text>
                <Text style={styles.modalSubtitle}>Paste your Mi Home tokens below</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalHint}>
              <Ionicons name="information-circle-outline" size={14} color={colors.amber} />
              <Text style={styles.modalHintText}>
                Get your User ID, Service Token, and ssecurity from the Mi Home app using a token extractor tool (e.g. xiaomi-cloud-tokens-extractor).
              </Text>
            </View>

            <Text style={styles.fieldLabel}>User ID</Text>
            <TextInput
              style={styles.input}
              value={form.userId}
              onChangeText={set('userId')}
              placeholder="1234567890"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Service Token</Text>
            <TextInput
              style={styles.input}
              value={form.serviceToken}
              onChangeText={set('serviceToken')}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>Security Key (ssecurity)</Text>
            <TextInput
              style={styles.input}
              value={form.ssecurity}
              onChangeText={set('ssecurity')}
              placeholder="base64-encoded key"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>Region</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {REGIONS.map(r => (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.regionChip, form.region === r.key && styles.regionChipActive]}
                    onPress={() => set('region')(r.key)}
                  >
                    <Text style={[styles.regionChipLabel, form.region === r.key && styles.regionChipLabelActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveBtn, (!form.userId || !form.serviceToken || !form.ssecurity) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving || !form.userId || !form.serviceToken || !form.ssecurity}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.saveBtnLabel}>Save & Connect</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── FanDeviceCard ─────────────────────────────────────────────────────────────

function FanDeviceCard({ device, isSelected, isOn, onSelect, onToggle, icon = 'aperture' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.deviceCard, isSelected && styles.deviceCardSelected]}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`Select ${device.name}`}
    >
      <View style={[styles.deviceIconWrap, isOn && { backgroundColor: colors.accentSoft }]}>
        <Ionicons
          name={icon}
          size={22}
          color={isOn || isSelected ? colors.accent : colors.textTertiary}
        />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.deviceName, isSelected && { color: colors.accent }]} numberOfLines={1}>
          {device.name}
        </Text>
        <Text style={styles.deviceModel}>{device.model}</Text>
      </View>
      <Switch
        value={isOn}
        onValueChange={onToggle}
        trackColor={{ false: colors.muted, true: colors.accent }}
        thumbColor="#fff"
        ios_backgroundColor={colors.muted}
      />
    </TouchableOpacity>
  );
}

// ── FanControls ───────────────────────────────────────────────────────────────

// ── Shared device controls ────────────────────────────────────────────────────

function OffTimer({ minutes, onSet, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.controlRow}>
        <Text style={styles.controlLabel}>Off Timer</Text>
        {minutes > 0 && (
          <Text style={styles.controlValue}>Off in {formatCountdown(minutes)}</Text>
        )}
      </View>
      <View style={styles.btnRow}>
        {TIMER_PRESETS.map(t => {
          const active = minutes === t.minutes;
          return (
            <TouchableOpacity
              key={t.minutes}
              style={[styles.optionBtn, active && styles.optionBtnActive]}
              onPress={() => onSet(t.minutes)}
              accessibilityRole="button"
              accessibilityLabel={t.minutes ? `Turn off in ${t.label}` : 'Cancel off timer'}
            >
              <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Child lock / display / beep toggles; renders nothing if the spec has none.
function DeviceSettings({ spec, state, onSet, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items  = DEVICE_SETTINGS.filter(i => spec.props[i.key]);
  if (items.length === 0) return null;
  return (
    <>
      <View style={styles.divider} />
      <View style={styles.btnRow}>
        {items.map(i => {
          const active = !!state[i.key];
          return (
            <TouchableOpacity
              key={i.key}
              style={[styles.optionBtn, active && styles.optionBtnActive]}
              onPress={() => onSet(i.key, !active)}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
              accessibilityLabel={i.label}
            >
              <Ionicons name={active ? i.on : i.off} size={14} color={active ? colors.accent : colors.textTertiary} />
              <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>{i.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

// ── FanControls ───────────────────────────────────────────────────────────────

function FanControls({ device, state, onTogglePower, onSetLevel, onSetMode, onSetOscillation, onSetSetting, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const spec   = getFanSpec(device.model);
  const modes  = FAN_MODES.filter(m => spec.modes.includes(m.id));
  return (
    <View style={styles.card}>
      {/* Power + oscillation row */}
      <View style={styles.controlRow}>
        <View style={styles.controlRowLeft}>
          <View style={[styles.controlIcon, state.on && styles.controlIconActive]}>
            <Ionicons
              name={state.on ? 'power' : 'power-outline'}
              size={18}
              color={state.on ? colors.accent : colors.textTertiary}
            />
          </View>
          <View>
            <Text style={styles.controlLabel}>Power</Text>
            <Text style={styles.controlValue}>{state.on ? 'On' : 'Off'}</Text>
          </View>
        </View>
        <Switch
          value={state.on}
          onValueChange={onTogglePower}
          trackColor={{ false: colors.muted, true: colors.accent }}
          thumbColor="#fff"
          ios_backgroundColor={colors.muted}
        />
      </View>

      <View style={styles.divider} />

      {/* Oscillation */}
      <View style={styles.controlRow}>
        <View style={styles.controlRowLeft}>
          <View style={[styles.controlIcon, state.oscillate && styles.controlIconActive]}>
            <Ionicons
              name={state.oscillate ? 'sync' : 'sync-outline'}
              size={18}
              color={state.oscillate ? colors.accent : colors.textTertiary}
            />
          </View>
          <Text style={styles.controlLabel}>Oscillation</Text>
        </View>
        <Switch
          value={state.oscillate}
          onValueChange={onSetOscillation}
          trackColor={{ false: colors.muted, true: colors.accent }}
          thumbColor="#fff"
          ios_backgroundColor={colors.muted}
        />
      </View>

      <View style={styles.divider} />

      {/* Speed levels */}
      <View style={{ gap: 10 }}>
        <Text style={styles.controlLabel}>Speed Level</Text>
        <View style={styles.btnRow}>
          {FAN_LEVELS.map(lvl => {
            const active = state.level === lvl;
            return (
              <TouchableOpacity
                key={lvl}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => onSetLevel(lvl)}
                accessibilityRole="button"
                accessibilityLabel={`Fan level ${lvl}`}
              >
                <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>
                  {lvl}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.divider} />

      {/* Mode */}
      <View style={{ gap: 10 }}>
        <Text style={styles.controlLabel}>Mode</Text>
        <View style={styles.btnRow}>
          {modes.map(m => {
            const active = state.mode === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => onSetMode(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`Fan mode ${m.label}`}
              >
                <Ionicons
                  name={m.icon}
                  size={14}
                  color={active ? colors.accent : colors.textTertiary}
                />
                <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {spec.props.timer && (
        <>
          <View style={styles.divider} />
          <OffTimer minutes={state.timer} onSet={(m) => onSetSetting('timer', m)} colors={colors} />
        </>
      )}

      <DeviceSettings spec={spec} state={state} onSet={onSetSetting} colors={colors} />
    </View>
  );
}

// ── HeaterControls ────────────────────────────────────────────────────────────

function HeaterControls({ device, state, onTogglePower, onStepTemp, onSetMode, onSetOscillation, onSetCountdown, onSetSetting, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const spec   = getHeaterSpec(device.model);
  const has    = (key) => !!spec.props[key];
  const modes  = HEATER_MODES.filter(m => spec.modes.includes(m.id));
  const [minTemp, maxTemp] = spec.tempRange ?? [null, null];
  const fault  = state.fault ? (HEATER_FAULTS[state.fault] ?? `Fault ${state.fault}`) : null;

  return (
    <View style={styles.card}>
      {fault && (
        <>
          <View style={styles.heaterFault}>
            <Ionicons name="warning-outline" size={16} color={colors.danger} />
            <Text style={styles.heaterFaultText}>{fault}</Text>
          </View>
          <View style={styles.divider} />
        </>
      )}

      {/* Power */}
      <View style={styles.controlRow}>
        <View style={styles.controlRowLeft}>
          <View style={[styles.controlIcon, state.on && styles.controlIconActive]}>
            <Ionicons
              name={state.on ? 'power' : 'power-outline'}
              size={18}
              color={state.on ? colors.accent : colors.textTertiary}
            />
          </View>
          <View>
            <Text style={styles.controlLabel}>Power</Text>
            <Text style={styles.controlValue}>
              {state.on ? 'On' : 'Off'}
              {state.temperature != null ? ` · Room ${state.temperature}°C` : ''}
            </Text>
          </View>
        </View>
        <Switch
          value={state.on}
          onValueChange={onTogglePower}
          trackColor={{ false: colors.muted, true: colors.accent }}
          thumbColor="#fff"
          ios_backgroundColor={colors.muted}
        />
      </View>

      {/* Target temperature */}
      {has('targetTemp') && (
        <>
          <View style={styles.divider} />
          <View style={styles.controlRow}>
            <View style={styles.controlRowLeft}>
              <View style={[styles.controlIcon, state.on && styles.controlIconActive]}>
                <Ionicons name="thermometer-outline" size={18} color={state.on ? colors.accent : colors.textTertiary} />
              </View>
              <Text style={styles.controlLabel}>Target</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, state.targetTemp != null && state.targetTemp <= minTemp && styles.stepperBtnDisabled]}
                onPress={() => onStepTemp(-1)}
                disabled={state.targetTemp != null && state.targetTemp <= minTemp}
                accessibilityRole="button"
                accessibilityLabel="Lower target temperature"
              >
                <Ionicons name="remove" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>
                {state.targetTemp != null ? `${state.targetTemp}°C` : '—'}
              </Text>
              <TouchableOpacity
                style={[styles.stepperBtn, state.targetTemp != null && state.targetTemp >= maxTemp && styles.stepperBtnDisabled]}
                onPress={() => onStepTemp(1)}
                disabled={state.targetTemp != null && state.targetTemp >= maxTemp}
                accessibilityRole="button"
                accessibilityLabel="Raise target temperature"
              >
                <Ionicons name="add" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Oscillation */}
      {has('oscillate') && (
        <>
          <View style={styles.divider} />
          <View style={styles.controlRow}>
            <View style={styles.controlRowLeft}>
              <View style={[styles.controlIcon, state.oscillate && styles.controlIconActive]}>
                <Ionicons
                  name={state.oscillate ? 'sync' : 'sync-outline'}
                  size={18}
                  color={state.oscillate ? colors.accent : colors.textTertiary}
                />
              </View>
              <Text style={styles.controlLabel}>Oscillation</Text>
            </View>
            <Switch
              value={state.oscillate}
              onValueChange={onSetOscillation}
              trackColor={{ false: colors.muted, true: colors.accent }}
              thumbColor="#fff"
              ios_backgroundColor={colors.muted}
            />
          </View>
        </>
      )}

      {/* Mode */}
      {modes.length > 0 && has('mode') && (
        <>
          <View style={styles.divider} />
          <View style={{ gap: 10 }}>
            <Text style={styles.controlLabel}>Mode</Text>
            <View style={styles.btnRow}>
              {modes.map(m => {
                const active = state.mode === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.optionBtn, active && styles.optionBtnActive]}
                    onPress={() => onSetMode(m.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Heater mode ${m.label}`}
                  >
                    <Ionicons name={m.icon} size={14} color={active ? colors.accent : colors.textTertiary} />
                    <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      )}

      {/* Off timer */}
      {has('countdown') && (
        <>
          <View style={styles.divider} />
          <OffTimer minutes={state.countdown} onSet={onSetCountdown} colors={colors} />
        </>
      )}

      <DeviceSettings spec={spec} state={state} onSet={onSetSetting} colors={colors} />
    </View>
  );
}

// ── VacuumCard ────────────────────────────────────────────────────────────────

function VacuumCard({ device, state, onStart, onPause, onDock, onFind, onSetSuction, onResetPart, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const known = VACUUM_STATUS_MAP[state.status];
  const info = known
    ? { ...known, color: colors[known.color] }
    : { label: `Status ${state.rawStatus ?? '?'}`, icon: 'ellipse-outline', color: colors.textTertiary };
  const isCleaning = state.status === 'cleaning';
  const isPaused   = state.status === 'paused';
  const stats = [
    state.cleanArea != null && `${state.cleanArea} m²`,
    state.cleanTime != null && formatCountdown(Math.round(state.cleanTime / 60)),
  ].filter(Boolean);

  return (
    <>
      {/* Status card */}
      <View style={styles.card}>
        <View style={styles.vacuumStatusRow}>
          <View style={[styles.vacuumIconWrap, { backgroundColor: info.color + '22' }]}>
            <Ionicons name="disc-outline" size={36} color={info.color} />
          </View>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={styles.deviceName}>{device.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: info.color + '22' }]}>
              <Ionicons name={info.icon} size={12} color={info.color} />
              <Text style={[styles.statusBadgeLabel, { color: info.color }]}>{info.label}</Text>
            </View>
            <Text style={styles.deviceModel}>{device.model}</Text>
          </View>
          {/* Battery */}
          <View style={styles.batteryWrap}>
            <Ionicons
              name={state.battery > 20 ? 'battery-half' : 'battery-dead-outline'}
              size={18}
              color={state.battery > 20 ? colors.sage : colors.danger}
            />
            <Text style={[styles.batteryText, { color: state.battery > 20 ? colors.sage : colors.danger }]}>
              {state.battery}%
            </Text>
          </View>
        </View>

        {stats.length > 0 && (
          <View style={styles.vacuumStatsRow}>
            <Ionicons name="stats-chart-outline" size={13} color={colors.textTertiary} />
            <Text style={styles.vacuumStatsText}>
              {isCleaning ? 'This run' : 'Last run'} · {stats.join(' · ')}
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* Action buttons */}
        <View style={styles.vacuumActions}>
          <TouchableOpacity
            style={[styles.vacuumActionBtn, isCleaning && styles.vacuumActionBtnActive]}
            onPress={isCleaning ? onPause : onStart}
            accessibilityRole="button"
            accessibilityLabel={isCleaning ? 'Pause cleaning' : 'Start cleaning'}
          >
            <Ionicons
              name={isCleaning ? 'pause' : 'play'}
              size={18}
              color={isCleaning ? colors.accent : colors.textSecondary}
            />
            <Text style={[styles.vacuumActionLabel, isCleaning && { color: colors.accent }]}>
              {isCleaning ? 'Pause' : isPaused ? 'Resume' : 'Clean'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.vacuumActionBtn}
            onPress={onDock}
            accessibilityRole="button"
            accessibilityLabel="Return to dock"
          >
            <Ionicons name="home-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.vacuumActionLabel}>Dock</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.vacuumActionBtn}
            onPress={onFind}
            accessibilityRole="button"
            accessibilityLabel="Find robot"
          >
            <Ionicons name="locate-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.vacuumActionLabel}>Find</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Suction */}
      <Text style={styles.sectionLabel}>SUCTION POWER</Text>
      <View style={styles.card}>
        <View style={styles.btnRow}>
          {SUCTION_LEVELS.map(s => {
            const active = state.suction === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => onSetSuction(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`Suction ${s.label}`}
              >
                <Ionicons
                  name={s.icon}
                  size={14}
                  color={active ? colors.accent : colors.textTertiary}
                />
                <Text style={[styles.optionBtnLabel, active && styles.optionBtnLabelActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Maintenance */}
      {state.parts.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>MAINTENANCE</Text>
          <View style={styles.card}>
            {state.parts.map((part, i) => {
              const meta  = VACUUM_PARTS[part.key] ?? { label: part.key, icon: 'construct-outline' };
              const color = partColor(part.life, colors);
              return (
                <React.Fragment key={part.key}>
                  <View style={styles.partRow}>
                    <Ionicons name={meta.icon} size={18} color={colors.textTertiary} />
                    <View style={styles.partInfo}>
                      <View style={styles.partHeader}>
                        <Text style={styles.controlLabel}>{meta.label}</Text>
                        <Text style={[styles.partLife, { color }]}>{part.life}%</Text>
                      </View>
                      <View style={styles.partTrack}>
                        <View style={[styles.partFill, { width: `${part.life}%`, backgroundColor: color }]} />
                      </View>
                      {part.hoursLeft != null && (
                        <Text style={styles.controlValue}>{part.hoursLeft} h left</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.partResetBtn}
                      onPress={() => onResetPart(part.key, meta.label)}
                      accessibilityRole="button"
                      accessibilityLabel={`Reset ${meta.label}`}
                    >
                      <Text style={styles.partResetLabel}>Reset</Text>
                    </TouchableOpacity>
                  </View>
                  {i < state.parts.length - 1 && <View style={styles.divider} />}
                </React.Fragment>
              );
            })}
          </View>
        </>
      )}
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function XiaomiScreen() {
  const { colors } = useTheme();
  const navScrollProps = useNavScrollProps();
  const { householdId } = useAuth();
  const { showAlert, showConfirm } = useAlert();
  const styles    = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const contentKey = useEntranceReplay();

  const [configured, setConfigured]   = useState(false);
  const [showSetup, setShowSetup]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [refreshing, setRefreshing]   = useState(false);

  const [fans, setFans]         = useState([]);
  const [heaters, setHeaters]   = useState([]);
  const [vacuums, setVacuums]   = useState([]);
  const [selectedFan, setSelectedFan]       = useState(null);
  const [selectedHeater, setSelectedHeater] = useState(null);
  const [selectedVacuum, setSelectedVacuum] = useState(null);
  const [fanStates, setFanStates]           = useState({});
  const [heaterStates, setHeaterStates]     = useState({});
  const [vacuumStates, setVacuumStates]     = useState({});

  const debounce = useRef({});

  const loadDevices = useCallback(async () => {
    try {
      // Household credentials are the source of truth — pull them into this
      // device's cache before reading, so shared creds work across devices.
      if (householdId) {
        try {
          const hh = await getHouseholdWithPrivate(householdId);
          await syncCredentialsFromHousehold(hh?.xiaomiCreds);
        } catch { /* offline — fall back to whatever's cached locally */ }
      }
      const creds = await getCredentials();
      setConfigured(hasCredentials(creds));
      if (!hasCredentials(creds)) { setLoading(false); return; }

      const all = await getDevices();
      const fanList    = all.filter(d => getDeviceType(d) === 'fan');
      const heaterList = all.filter(d => getDeviceType(d) === 'heater');
      const vacuumList = all.filter(d => getDeviceType(d) === 'vacuum');

      setFans(fanList);
      setHeaters(heaterList);
      setVacuums(vacuumList);
      if (fanList.length > 0 && !selectedFan)       setSelectedFan(fanList[0].did);
      if (heaterList.length > 0 && !selectedHeater) setSelectedHeater(heaterList[0].did);
      if (vacuumList.length > 0 && !selectedVacuum) setSelectedVacuum(vacuumList[0].did);

      // Fetch initial states
      const fStates = {};
      for (const d of fanList) {
        try {
          const props = await getFanState(d);
          fStates[d.did] = fanStateFromProps(Array.isArray(props) ? props : [], d.model);
        } catch { fStates[d.did] = { ...DEFAULT_FAN }; }
      }
      setFanStates(fStates);

      const hStates = {};
      for (const d of heaterList) {
        try {
          const props = await getHeaterState(d);
          hStates[d.did] = heaterStateFromProps(Array.isArray(props) ? props : [], d.model);
        } catch { hStates[d.did] = { ...DEFAULT_HEATER }; }
      }
      setHeaterStates(hStates);

      const vStates = {};
      for (const d of vacuumList) {
        try {
          const props = await getVacuumState(d);
          vStates[d.did] = vacuumStateFromProps(Array.isArray(props) ? props : [], d.model);
        } catch { vStates[d.did] = { ...DEFAULT_VACUUM }; }
      }
      setVacuumStates(vStates);
      setError(null);
    } catch (e) {
      if (e.message !== 'NOT_CONFIGURED') setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedFan, selectedHeater, selectedVacuum, householdId]);

  useEffect(() => { loadDevices(); }, [householdId]);

  const handleRefresh = () => { setRefreshing(true); loadDevices(); };

  // ── Fan helpers ─────────────────────────────────────────────────────────────

  const updateFan = useCallback((did, patch) => {
    setFanStates(prev => ({ ...prev, [did]: { ...(prev[did] ?? DEFAULT_FAN), ...patch } }));
  }, []);

  const handleFanToggle = useCallback((did) => {
    const fan = fans.find(f => f.did === did);
    if (!fan) return;
    const next = !(fanStates[did]?.on ?? false);
    updateFan(did, { on: next });
    setFanPower(fan, next).catch(console.error);
  }, [fans, fanStates, updateFan]);

  const selectedFanDevice = fans.find(f => f.did === selectedFan);

  const handleFanLevel = useCallback((lvl) => {
    if (!selectedFanDevice) return;
    updateFan(selectedFan, { level: lvl });
    setFanLevel(selectedFanDevice, lvl).catch(console.error);
  }, [selectedFan, selectedFanDevice, updateFan]);

  const handleFanMode = useCallback((mode) => {
    if (!selectedFanDevice) return;
    updateFan(selectedFan, { mode });
    setFanMode(selectedFanDevice, mode).catch(console.error);
  }, [selectedFan, selectedFanDevice, updateFan]);

  const handleFanOscillation = useCallback((v) => {
    if (!selectedFanDevice) return;
    updateFan(selectedFan, { oscillate: v });
    setFanOscillation(selectedFanDevice, v).catch(console.error);
  }, [selectedFan, selectedFanDevice, updateFan]);

  // Timer, child lock, display, beep.
  const handleFanSetting = useCallback((key, value) => {
    if (!selectedFanDevice) return;
    updateFan(selectedFan, { [key]: value });
    FAN_SETTERS[key](selectedFanDevice, value).catch(console.error);
  }, [selectedFan, selectedFanDevice, updateFan]);

  // ── Heater helpers ──────────────────────────────────────────────────────────

  const updateHeater = useCallback((did, patch) => {
    setHeaterStates(prev => ({ ...prev, [did]: { ...(prev[did] ?? DEFAULT_HEATER), ...patch } }));
  }, []);

  const selectedHeaterDevice = heaters.find(h => h.did === selectedHeater);

  const handleHeaterToggle = useCallback((did, value) => {
    const heater = heaters.find(h => h.did === did);
    if (!heater) return;
    const next = value ?? !(heaterStates[did]?.on ?? false);
    updateHeater(did, { on: next });
    setHeaterPower(heater, next).catch(console.error);
  }, [heaters, heaterStates, updateHeater]);

  // Debounced so rapid taps send one request with the final value.
  const handleHeaterStepTemp = useCallback((delta) => {
    const device = selectedHeaterDevice;
    if (!device) return;
    const cur  = heaterStates[device.did]?.targetTemp ?? getHeaterSpec(device.model).tempRange?.[0];
    if (cur == null) return;
    const next = clampTargetTemp(device.model, cur + delta);
    updateHeater(device.did, { targetTemp: next });
    clearTimeout(debounce.current[device.did]);
    debounce.current[device.did] = setTimeout(() => {
      setHeaterTargetTemp(device, next).catch(console.error);
    }, TEMP_DEBOUNCE_MS);
  }, [selectedHeaterDevice, heaterStates, updateHeater]);

  useEffect(() => () => Object.values(debounce.current).forEach(clearTimeout), []);

  const handleHeaterMode = useCallback((mode) => {
    if (!selectedHeaterDevice) return;
    updateHeater(selectedHeater, { mode });
    setHeaterMode(selectedHeaterDevice, mode).catch(console.error);
  }, [selectedHeater, selectedHeaterDevice, updateHeater]);

  const handleHeaterOscillation = useCallback((v) => {
    if (!selectedHeaterDevice) return;
    updateHeater(selectedHeater, { oscillate: v });
    setHeaterOscillation(selectedHeaterDevice, v).catch(console.error);
  }, [selectedHeater, selectedHeaterDevice, updateHeater]);

  const handleHeaterCountdown = useCallback((minutes) => {
    if (!selectedHeaterDevice) return;
    updateHeater(selectedHeater, { countdown: minutes });
    setHeaterCountdown(selectedHeaterDevice, minutes).catch(console.error);
  }, [selectedHeater, selectedHeaterDevice, updateHeater]);

  // Child lock, display, beep.
  const handleHeaterSetting = useCallback((key, value) => {
    if (!selectedHeaterDevice) return;
    updateHeater(selectedHeater, { [key]: value });
    HEATER_SETTERS[key](selectedHeaterDevice, value).catch(console.error);
  }, [selectedHeater, selectedHeaterDevice, updateHeater]);

  // ── Vacuum helpers ──────────────────────────────────────────────────────────

  const updateVacuum = useCallback((did, patch) => {
    setVacuumStates(prev => ({ ...prev, [did]: { ...(prev[did] ?? DEFAULT_VACUUM), ...patch } }));
  }, []);

  const selectedVacuumDevice = vacuums.find(v => v.did === selectedVacuum);

  // Clean button: pause while cleaning, resume while paused, otherwise start.
  const handleVacuumStart = useCallback(() => {
    if (!selectedVacuumDevice) return;
    const cur = vacuumStates[selectedVacuum]?.status;
    if (cur === 'cleaning') {
      updateVacuum(selectedVacuum, { status: 'paused' });
      pauseCleaning(selectedVacuumDevice).catch(console.error);
    } else {
      updateVacuum(selectedVacuum, { status: 'cleaning' });
      (cur === 'paused' ? resumeCleaning : startCleaning)(selectedVacuumDevice).catch(console.error);
    }
  }, [selectedVacuum, selectedVacuumDevice, vacuumStates, updateVacuum]);

  const handleVacuumPause = useCallback(() => {
    if (!selectedVacuumDevice) return;
    updateVacuum(selectedVacuum, { status: 'paused' });
    pauseCleaning(selectedVacuumDevice).catch(console.error);
  }, [selectedVacuum, selectedVacuumDevice, updateVacuum]);

  const handleVacuumDock = useCallback(() => {
    if (!selectedVacuumDevice) return;
    updateVacuum(selectedVacuum, { status: 'returning' });
    returnToDock(selectedVacuumDevice).catch(console.error);
  }, [selectedVacuum, selectedVacuumDevice, updateVacuum]);

  const handleVacuumFind = useCallback(() => {
    if (!selectedVacuumDevice) return;
    findVacuum(selectedVacuumDevice).catch(console.error);
  }, [selectedVacuumDevice]);

  const handleSuction = useCallback((level) => {
    if (!selectedVacuumDevice) return;
    updateVacuum(selectedVacuum, { suction: level });
    setVacuumSuction(selectedVacuumDevice, level).catch(console.error);
  }, [selectedVacuum, selectedVacuumDevice, updateVacuum]);

  const handleResetPart = useCallback(async (key, label) => {
    const device = selectedVacuumDevice;
    if (!device) return;
    const ok = await showConfirm({
      title: `Reset ${label.toLowerCase()}?`,
      message: 'Do this after replacing or cleaning it. Its life goes back to 100%.',
      type: 'warning',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    try {
      await resetVacuumPart(device, key);
      const props = await getVacuumState(device);
      updateVacuum(device.did, vacuumStateFromProps(Array.isArray(props) ? props : [], device.model));
    } catch (e) {
      showAlert({ title: 'Reset failed', message: e.message, type: 'error' });
    }
  }, [selectedVacuumDevice, showConfirm, showAlert, updateVacuum]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const innerStyle = isDesktop
    ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }
    : undefined;

  const selectedFanState     = fanStates[selectedFan]    ?? DEFAULT_FAN;
  const selectedHeaterState  = heaterStates[selectedHeater] ?? DEFAULT_HEATER;
  const deviceCount          = fans.length + heaters.length + vacuums.length;
  const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;
  const selectedVacuumState  = vacuumStates[selectedVacuum] ?? DEFAULT_VACUUM;

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.subtitle, { marginTop: 12 }]}>Connecting to Mi Home…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, Platform.OS === 'android' && { paddingTop: 24 }]}>
      <CredentialsModal
        visible={showSetup}
        colors={colors}
        householdId={householdId}
        onClose={() => setShowSetup(false)}
        onSaved={() => { setLoading(true); loadDevices(); }}
      />

      <ScrollView
        key={contentKey}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, innerStyle]}
        showsVerticalScrollIndicator={false}
        {...navScrollProps}
      >
        {/* Header */}
        <Rise index={0}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Xiaomi</Text>
            <Text style={styles.subtitle}>
              {deviceCount === 0 && configured
                ? 'No devices found'
                : [plural(fans.length, 'fan'), plural(heaters.length, 'heater'), plural(vacuums.length, 'vacuum')].join(' · ')
              }
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {configured && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleRefresh}
                accessibilityRole="button"
                accessibilityLabel="Refresh devices"
              >
                <Ionicons
                  name={refreshing ? 'sync' : 'refresh-outline'}
                  size={18}
                  color={refreshing ? colors.accent : colors.textSecondary}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSetup(true)}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerBadge}>
              <Ionicons name="wifi" size={12} color={colors.accent} />
              <Text style={styles.headerBadgeText}>Mi Home</Text>
            </View>
          </View>
        </View>
        </Rise>

        {/* Not configured */}
        {!configured && (
          <TouchableOpacity style={styles.setupBanner} onPress={() => setShowSetup(true)}>
            <Ionicons name="key-outline" size={20} color={colors.amber} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.setupBannerTitle}>Connect Mi Home</Text>
              <Text style={styles.setupBannerBody}>Tap to enter your Mi Home tokens and start controlling devices.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* Error */}
        {configured && error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Fans section */}
        {fans.length > 0 && (
          <>
          <Rise index={1}>
            <View style={styles.sectionLabelRow}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>FANS</Text>
              {fans.filter(f => fanStates[f.did]?.on).length > 0 && (
                <View style={styles.activeBadge}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeBadgeText}>
                    {fans.filter(f => fanStates[f.did]?.on).length} on
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.card}>
              {fans.map((fan, i) => (
                <React.Fragment key={fan.did}>
                  <FanDeviceCard
                    device={fan}
                    isSelected={fan.did === selectedFan}
                    isOn={fanStates[fan.did]?.on ?? false}
                    onSelect={() => setSelectedFan(fan.did)}
                    onToggle={() => handleFanToggle(fan.did)}
                  />
                  {i < fans.length - 1 && <View style={styles.divider} />}
                </React.Fragment>
              ))}
            </View>

            {selectedFanDevice && (
              <>
                <View style={styles.controlsHeader}>
                  <Text style={styles.sectionLabel}>CONTROLS</Text>
                  <Text style={styles.selectedLabel}>{selectedFanDevice.name}</Text>
                </View>
                <FanControls
                  device={selectedFanDevice}
                  state={selectedFanState}
                  onTogglePower={(v) => { updateFan(selectedFan, { on: v }); setFanPower(selectedFanDevice, v).catch(console.error); }}
                  onSetLevel={handleFanLevel}
                  onSetMode={handleFanMode}
                  onSetOscillation={handleFanOscillation}
                  onSetSetting={handleFanSetting}
                  colors={colors}
                />
              </>
            )}
          </Rise>
          </>
        )}

        {/* Heaters section */}
        {heaters.length > 0 && (
          <>
          <Rise index={2}>
            <View style={[styles.sectionLabelRow, { marginTop: fans.length > 0 ? spacing.xl : 0 }]}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>HEATERS</Text>
              {heaters.filter(h => heaterStates[h.did]?.on).length > 0 && (
                <View style={styles.activeBadge}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeBadgeText}>
                    {heaters.filter(h => heaterStates[h.did]?.on).length} on
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.card}>
              {heaters.map((heater, i) => (
                <React.Fragment key={heater.did}>
                  <FanDeviceCard
                    device={heater}
                    icon="flame"
                    isSelected={heater.did === selectedHeater}
                    isOn={heaterStates[heater.did]?.on ?? false}
                    onSelect={() => setSelectedHeater(heater.did)}
                    onToggle={() => handleHeaterToggle(heater.did)}
                  />
                  {i < heaters.length - 1 && <View style={styles.divider} />}
                </React.Fragment>
              ))}
            </View>

            {selectedHeaterDevice && (
              <>
                <View style={styles.controlsHeader}>
                  <Text style={styles.sectionLabel}>CONTROLS</Text>
                  <Text style={styles.selectedLabel}>{selectedHeaterDevice.name}</Text>
                </View>
                <HeaterControls
                  device={selectedHeaterDevice}
                  state={selectedHeaterState}
                  onTogglePower={(v) => handleHeaterToggle(selectedHeater, v)}
                  onStepTemp={handleHeaterStepTemp}
                  onSetMode={handleHeaterMode}
                  onSetOscillation={handleHeaterOscillation}
                  onSetCountdown={handleHeaterCountdown}
                  onSetSetting={handleHeaterSetting}
                  colors={colors}
                />
              </>
            )}
          </Rise>
          </>
        )}

        {/* Vacuum section */}
        {vacuums.length > 0 && (
          <>
          <Rise index={3}>
            <View style={[styles.sectionLabelRow, { marginTop: fans.length + heaters.length > 0 ? spacing.xl : 0 }]}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>VACUUM</Text>
              {selectedVacuumState.status === 'cleaning' && (
                <View style={styles.activeBadge}>
                  <View style={[styles.activeDot, { backgroundColor: colors.sage }]} />
                  <Text style={styles.activeBadgeText}>Cleaning</Text>
                </View>
              )}
            </View>

            {/* Vacuum picker if multiple */}
            {vacuums.length > 1 && (
              <View style={styles.card}>
                {vacuums.map((vac, i) => (
                  <React.Fragment key={vac.did}>
                    <TouchableOpacity
                      style={[styles.deviceCard, vac.did === selectedVacuum && styles.deviceCardSelected]}
                      onPress={() => setSelectedVacuum(vac.did)}
                    >
                      <View style={styles.deviceIconWrap}>
                        <Ionicons name="disc-outline" size={22} color={vac.did === selectedVacuum ? colors.accent : colors.textTertiary} />
                      </View>
                      <Text style={[styles.deviceName, { marginLeft: 12 }, vac.did === selectedVacuum && { color: colors.accent }]}>
                        {vac.name}
                      </Text>
                    </TouchableOpacity>
                    {i < vacuums.length - 1 && <View style={styles.divider} />}
                  </React.Fragment>
                ))}
              </View>
            )}

            {selectedVacuumDevice && (
              <VacuumCard
                device={selectedVacuumDevice}
                state={selectedVacuumState}
                onStart={handleVacuumStart}
                onPause={handleVacuumPause}
                onDock={handleVacuumDock}
                onFind={handleVacuumFind}
                onSetSuction={handleSuction}
                onResetPart={handleResetPart}
                colors={colors}
              />
            )}
          </Rise>
          </>
        )}

        {/* Empty state when configured but no devices */}
        {configured && deviceCount === 0 && !error && (
          <View style={styles.emptyState}>
            <Ionicons name="home-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.title, { marginTop: 16, textAlign: 'center', fontSize: 18 }]}>No devices found</Text>
            <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 8 }]}>
              Make sure your fans, heaters and vacuum are linked in Mi Home and try refreshing.
            </Text>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors) => StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.background },
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

  iconBtn: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...type.label, color: colors.textTertiary,
    marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  activeBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },

  controlsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  selectedLabel: { ...type.caption, color: colors.accent },

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
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  deviceCardSelected: { backgroundColor: colors.accentSoft },
  deviceIconWrap: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  deviceName:  { ...type.bodyMed, color: colors.textPrimary },
  deviceModel: { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  controlRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlIcon: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  controlIconActive: { backgroundColor: colors.accentSoft },
  controlLabel:      { ...type.bodyMed, color: colors.textPrimary },
  controlValue:      { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  btnRow: { flexDirection: 'row', gap: 8 },
  optionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10,
    backgroundColor: colors.muted, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  optionBtnActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  optionBtnLabel:       { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  optionBtnLabelActive: { color: colors.accent },

  // Vacuum
  vacuumStatusRow: { flexDirection: 'row', alignItems: 'center' },
  vacuumIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
    marginTop: 4, marginBottom: 4,
  },
  statusBadgeLabel: { ...type.caption, fontWeight: '700' },
  batteryWrap: { alignItems: 'center', gap: 3 },
  vacuumStatsRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  vacuumStatsText: { ...type.caption, color: colors.textTertiary },
  partRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  partInfo:   { flex: 1, gap: 4 },
  partHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  partLife:   { ...type.caption, fontWeight: '700' },
  partTrack:  { height: 6, borderRadius: radius.full, backgroundColor: colors.muted, overflow: 'hidden' },
  partFill:   { height: '100%', borderRadius: radius.full },
  partResetBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.muted, borderRadius: radius.md,
  },
  partResetLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  batteryText:  { ...type.caption, fontWeight: '700' },

  // Heater
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperValue: { ...type.bodyMed, color: colors.textPrimary, minWidth: 52, textAlign: 'center' },
  heaterFault: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md, padding: spacing.sm,
  },
  heaterFaultText: { ...type.caption, color: colors.danger, fontWeight: '700', flex: 1 },

  vacuumActions: { flexDirection: 'row', gap: 8 },
  vacuumActionBtn: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12,
    backgroundColor: colors.muted, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  vacuumActionBtnActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  vacuumActionLabel:     { ...type.caption, color: colors.textSecondary, fontWeight: '700' },

  // Setup banner
  setupBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.amberSoft,
    borderWidth: 1, borderColor: colors.amber + '44',
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: 4,
  },
  setupBannerTitle: { ...type.bodyMed, color: colors.amber, marginBottom: 2 },
  setupBannerBody:  { ...type.caption, color: colors.textSecondary, lineHeight: 16 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1, borderColor: colors.danger + '44',
    borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorBannerText: { ...type.caption, color: colors.danger, flex: 1 },

  emptyState: { alignItems: 'center', paddingVertical: 48 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'flex-end', alignItems: 'center',
  },
  modalSheet: {
    width: '100%', maxWidth: 560,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing.xxl,
    paddingBottom: 48,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  modalTitle:    { ...type.h3, color: colors.textPrimary },
  modalSubtitle: { ...type.caption, color: colors.textTertiary, marginTop: 3 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  modalHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.amberSoft,
    borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.lg,
  },
  modalHintText: { ...type.caption, color: colors.textSecondary, flex: 1, lineHeight: 16 },

  fieldLabel: { ...type.label, color: colors.textTertiary, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.muted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    color: colors.textPrimary,
    ...type.body,
    marginBottom: spacing.xs,
  },
  regionChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  regionChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  regionChipLabel:  { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  regionChipLabelActive: { color: colors.accent },
  saveBtn: {
    backgroundColor: colors.accent, borderRadius: radius.lg,
    paddingVertical: 15, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnLabel:    { ...type.bodyMed, color: '#fff', fontWeight: '700' },
});
