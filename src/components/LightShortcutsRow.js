import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { spacing, radius, type } from '../theme/colors';
import { deleteLightShortcut } from '../services/firestore';
import { applyActionsToDevice } from '../services/govee';

export const SHORTCUT_VISUALS = [
  { icon: 'flash',         color: '#FFB347' },
  { icon: 'moon',          color: '#9B59B6' },
  { icon: 'sunny',         color: '#FFD700' },
  { icon: 'film',          color: '#FF6B35' },
  { icon: 'book',          color: '#1E90FF' },
  { icon: 'heart',         color: '#FF69B4' },
  { icon: 'restaurant',    color: '#7DB07A' },
  { icon: 'game-controller', color: '#00BFFF' },
];

function ShortcutCard({ shortcut, isRunning, onRun, onOptions }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const visual = SHORTCUT_VISUALS[shortcut.visual % SHORTCUT_VISUALS.length];
  return (
    // Options button is a sibling, not a child, of the card: nesting one
    // TouchableOpacity inside another renders as nested <button>s on web (invalid HTML).
    <View style={styles.shortcutCardWrap}>
      <TouchableOpacity
        style={styles.shortcutCard}
        onPress={onRun}
        onLongPress={onOptions}
        disabled={isRunning}
        accessibilityRole="button"
        accessibilityLabel={`Run ${shortcut.name} shortcut`}
      >
        <View style={[styles.shortcutIcon, { backgroundColor: visual.color + '33' }]}>
          {isRunning
            ? <ActivityIndicator size="small" color={visual.color} />
            : <Ionicons name={visual.icon} size={26} color={visual.color} />}
        </View>
        <Text style={styles.shortcutName} numberOfLines={1}>{shortcut.name}</Text>
        <Text style={styles.shortcutMeta}>
          {shortcut.deviceIds.length} {shortcut.deviceIds.length === 1 ? 'light' : 'lights'}
        </Text>
      </TouchableOpacity>
      {onOptions && (
        <TouchableOpacity
          style={styles.shortcutOptionsBtn}
          onPress={onOptions}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${shortcut.name} shortcut options`}
        >
          <Ionicons name="ellipsis-horizontal" size={14} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Horizontal row of tappable shortcut cards. Tap runs the shortcut against the
// given devices; the ⋯ menu (edit/delete) only appears when onEdit is provided.
export default function LightShortcutsRow({
  householdId, apiKey, devices, shortcuts,
  onDevicePatch,   // optional: (deviceId, patch) called as each device updates
  onCreateNew,     // optional: shows the dashed "New" card
  onEdit,          // optional: enables the options menu with Edit + Delete
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { showAlert, showOptions, showConfirm } = useAlert();
  const [runningId, setRunningId] = useState(null);

  const runShortcut = useCallback(async (shortcut) => {
    if (!apiKey || runningId) return;
    setRunningId(shortcut.id);
    const actions = shortcut.actions ?? {};
    const failed = [];
    // Sequential on purpose — parallel bursts trip Govee's rate limits
    for (const id of shortcut.deviceIds) {
      const dev = devices.find((d) => d.device === id);
      if (!dev) continue;
      try {
        const patch = await applyActionsToDevice(apiKey, dev, actions);
        onDevicePatch?.(id, patch);
      } catch (e) {
        console.error('[Shortcut]', dev.deviceName, e);
        failed.push(dev.deviceName);
      }
    }
    setRunningId(null);
    if (failed.length > 0) {
      showAlert({
        title: 'Shortcut partially failed',
        message: `Could not update: ${failed.join(', ')}`,
        type: 'warning',
      });
    }
  }, [apiKey, runningId, devices, onDevicePatch, showAlert]);

  const handleOptions = useCallback(async (shortcut) => {
    const choice = await showOptions({
      title: shortcut.name,
      icon: 'flash-outline',
      options: [
        { label: 'Edit', value: 'edit' },
        { label: 'Delete', value: 'delete', style: 'destructive' },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
    if (choice === 'edit') onEdit(shortcut);
    if (choice === 'delete') {
      const ok = await showConfirm({
        title: 'Delete shortcut?',
        message: `"${shortcut.name}" will be removed for the whole household.`,
        confirmLabel: 'Delete',
      });
      if (ok) deleteLightShortcut(householdId, shortcut.id).catch(console.error);
    }
  }, [showOptions, showConfirm, onEdit, householdId]);

  if (shortcuts.length === 0 && !onCreateNew) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.shortcutsRow}
    >
      {shortcuts.map((shortcut) => (
        <ShortcutCard
          key={shortcut.id}
          shortcut={shortcut}
          isRunning={runningId === shortcut.id}
          onRun={() => runShortcut(shortcut)}
          onOptions={onEdit ? () => handleOptions(shortcut) : undefined}
        />
      ))}
      {onCreateNew && (
        <TouchableOpacity
          style={[styles.shortcutCard, styles.shortcutCardAdd]}
          onPress={onCreateNew}
          accessibilityRole="button"
          accessibilityLabel="Create shortcut"
        >
          <View style={[styles.shortcutIcon, { backgroundColor: colors.muted }]}>
            <Ionicons name="add" size={24} color={colors.textSecondary} />
          </View>
          <Text style={styles.shortcutName} numberOfLines={1}>New</Text>
          <Text style={styles.shortcutMeta}>shortcut</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  shortcutsRow: { flexDirection: 'row', gap: 10, paddingBottom: 2 },
  shortcutCardWrap: { position: 'relative' },
  shortcutCard: {
    width: 124,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center', gap: 5,
  },
  shortcutCardAdd: { borderStyle: 'dashed' },
  shortcutOptionsBtn: {
    position: 'absolute', top: 4, right: 6, zIndex: 1,
  },
  shortcutIcon: {
    width: 54, height: 54, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  shortcutName: { ...type.caption, color: colors.textPrimary, fontWeight: '700', textAlign: 'center', fontSize: 13 },
  shortcutMeta: { ...type.caption, color: colors.textTertiary, fontSize: 11 },
});
