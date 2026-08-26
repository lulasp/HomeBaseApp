import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import {
  createHousehold, joinHousehold, getHouseholdsByIds,
} from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';

export default function ProfileScreen({ navigation }) {
  const {
    user, householdId, householdIds, displayName,
    saveHouseholdId, switchHousehold, updateDisplayName, signOut,
  } = useAuth();
  const { colors, theme, toggleTheme } = useTheme();
  const navScrollProps = useNavScrollProps();
  const contentKey = useEntranceReplay();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();
  const styles  = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();

  const [households, setHouseholds]   = useState([]);
  const [loadingHH, setLoadingHH]     = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput]     = useState(displayName);

  // Add-household sheet
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetTab, setSheetTab]         = useState('create');
  const [hhName, setHhName]             = useState('');
  const [inviteCode, setInviteCode]     = useState('');
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetErrors, setSheetErrors]   = useState({});

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!householdIds.length) { setHouseholds([]); setLoadingHH(false); return; }
    setLoadingHH(true);
    getHouseholdsByIds(householdIds)
      .then(setHouseholds)
      .finally(() => setLoadingHH(false));
  }, [householdIds.join(',')]);

  const saveName = async () => {
    await updateDisplayName(nameInput);
    setEditingName(false);
  };

  const closeSheet = () => { setSheetVisible(false); setHhName(''); setInviteCode(''); setSheetErrors({}); };

  const handleCreateHousehold = async () => {
    if (!hhName.trim()) { setSheetErrors({ hhName: 'Required' }); return; }
    setSheetLoading(true);
    try {
      const id = await createHousehold(user.uid, hhName.trim(), { name: user.displayName || '', email: user.email || '' });
      await saveHouseholdId(id);
      notify('Household created', `"${hhName.trim()}" is ready.`, { type: 'success' });
      closeSheet();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setSheetLoading(false);
    }
  };

  const handleJoinHousehold = async () => {
    if (!inviteCode.trim()) { setSheetErrors({ inviteCode: 'Required' }); return; }
    setSheetLoading(true);
    try {
      const id = await joinHousehold(user.uid, inviteCode.trim(), { name: user.displayName || '', email: user.email || '' });
      await saveHouseholdId(id);
      notify('Joined household', "You've been added to the household.", { type: 'success' });
      closeSheet();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setSheetLoading(false);
    }
  };

  const initials = (displayName || 'Y').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <View style={{ height: windowHeight, backgroundColor: colors.background }}>
      <ScrollView
        key={contentKey}
        style={{ flex: 1, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }}
        {...navScrollProps}
        contentContainerStyle={[
          styles.scrollContent,
          isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator
      >
        <Rise index={0}>
        {/* ── Header ── */}
        <Text style={styles.screenTitle}>Profile</Text>

        {/* ── User card ── */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              {editingName ? (
                <View style={styles.nameEditRow}>
                  <TextInput
                    style={styles.nameInput}
                    value={nameInput}
                    onChangeText={setNameInput}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                    placeholderTextColor={colors.textTertiary}
                    placeholder="Your name"
                    accessibilityLabel="Display name"
                  />
                  <TouchableOpacity onPress={saveName} style={styles.nameEditSave} accessibilityRole="button">
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setEditingName(false); setNameInput(displayName); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.nameRow} onPress={() => setEditingName(true)} accessibilityRole="button">
                  <Text style={styles.userName}>{displayName || 'Set your name'}</Text>
                  <Ionicons name="pencil-outline" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
              <Text style={styles.userId} numberOfLines={1}>ID: {user?.uid?.slice(0, 16)}…</Text>
            </View>
          </View>
        </View>
        </Rise>

        <Rise index={1}>
        {/* ── Households ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Households</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => { setSheetTab('create'); setSheetVisible(true); }}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addButtonLabel}>Add</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          {loadingHH ? (
            <ActivityIndicator color={colors.accent} style={{ padding: spacing.xl }} />
          ) : households.length === 0 ? (
            <Text style={styles.emptyText}>No households yet.</Text>
          ) : (
            households.map((hh, i) => {
              const isActive = hh.id === householdId;
              return (
                <View key={hh.id} style={[styles.hhRow, i > 0 && styles.hhRowBorder]}>
                  <View style={[styles.hhIconRing, isActive && { backgroundColor: colors.accentSoft }]}>
                    <Ionicons name="home" size={16} color={isActive ? colors.accent : colors.textTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hhName} numberOfLines={1}>{hh.name}</Text>
                    {isActive && (
                      <Text style={styles.hhActive}>Active</Text>
                    )}
                  </View>
                  {!isActive && (
                    <TouchableOpacity
                      style={styles.switchButton}
                      onPress={() => switchHousehold(hh.id)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.switchButtonLabel}>Switch</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.editIconButton}
                    onPress={() => navigation.navigate('HouseholdEdit', { householdId: hh.id })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${hh.name}`}
                  >
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
        </Rise>

        <Rise index={2}>
        {/* ── App ── */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>App</Text>

        <View style={styles.card}>
          <TouchableOpacity style={styles.settingsRow} onPress={toggleTheme} accessibilityRole="button">
            <Ionicons
              name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
              size={18}
              color={colors.textSecondary}
            />
            <Text style={[styles.settingsLabel, { flex: 1, color: colors.textPrimary }]}>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={[styles.settingsRow, styles.settingsRowBorder, { opacity: 0.5 }]}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.settingsLabel, { flex: 1, color: colors.textPrimary }]}>Version 1.0</Text>
          </View>

          <TouchableOpacity
            style={[styles.settingsRow, styles.settingsRowBorder]}
            onPress={async () => {
              const confirmed = await showConfirm({
                title: 'Sign out',
                message: 'Are you sure you want to sign out?',
                type: 'danger',
                confirmLabel: 'Sign Out',
              });
              if (confirmed) signOut();
            }}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={[styles.settingsLabel, { flex: 1, color: colors.danger }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>
        </Rise>

      </ScrollView>

      {/* ── Add Household Sheet ── */}
      <Modal visible={sheetVisible} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
          <View style={styles.bottomSheet}>
            <View style={styles.dragHandle} />
            <Text style={styles.sheetTitle}>Add Household</Text>

            <View style={styles.tabRow}>
              {[
                { id: 'create', label: 'Create New' },
                { id: 'join',   label: 'Join Existing' },
              ].map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.tabButton, sheetTab === t.id && styles.tabButtonActive]}
                  onPress={() => { setSheetTab(t.id); setSheetErrors({}); }}
                  accessibilityRole="tab"
                >
                  <Text style={[styles.tabLabel, sheetTab === t.id && styles.tabLabelActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {sheetTab === 'create' ? (
              <>
                <Text style={styles.inputLabel}>Household Name *</Text>
                <View>
                  <TextInput
                    style={[styles.textInput, !!sheetErrors.hhName && styles.inputError]}
                    placeholder="e.g. The Smith Family"
                    value={hhName}
                    onChangeText={(t) => { setHhName(t); if (sheetErrors.hhName) setSheetErrors((e) => ({ ...e, hhName: null })); }}
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    onSubmitEditing={handleCreateHousehold}
                    autoFocus
                  />
                  {!!sheetErrors.hhName && <Text style={styles.errorText}>{sheetErrors.hhName}</Text>}
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, sheetLoading && { opacity: 0.5 }]}
                  onPress={handleCreateHousehold}
                  disabled={sheetLoading}
                >
                  <Text style={styles.primaryButtonLabel}>{sheetLoading ? 'Creating…' : 'Create Household'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>Invite Code *</Text>
                <View>
                  <TextInput
                    style={[styles.textInput, { textAlign: 'center', letterSpacing: 6, ...type.h4 }, !!sheetErrors.inviteCode && styles.inputError]}
                    placeholder="ABC123"
                    value={inviteCode}
                    onChangeText={(t) => { setInviteCode(t); if (sheetErrors.inviteCode) setSheetErrors((e) => ({ ...e, inviteCode: null })); }}
                    autoCapitalize="characters"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    onSubmitEditing={handleJoinHousehold}
                    autoFocus
                  />
                  {!!sheetErrors.inviteCode && <Text style={styles.errorText}>{sheetErrors.inviteCode}</Text>}
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, sheetLoading && { opacity: 0.5 }]}
                  onPress={handleJoinHousehold}
                  disabled={sheetLoading}
                >
                  <Text style={styles.primaryButtonLabel}>{sheetLoading ? 'Joining…' : 'Join Household'}</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.cancelButton} onPress={closeSheet}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root:          { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: 120, gap: spacing.md },

  screenTitle: { ...type.h2, color: colors.textPrimary, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },

  // User card
  avatarRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl },
  avatar: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.accentSoft, borderWidth: 1.5, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarInitials: { ...type.h3, color: colors.accent },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEditRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName:   { ...type.h4, color: colors.textPrimary },
  nameInput: {
    flex: 1, height: 36, borderWidth: 1, borderColor: colors.accent,
    borderRadius: radius.sm, paddingHorizontal: spacing.md,
    ...type.body, color: colors.textPrimary, backgroundColor: colors.surfaceElevated,
  },
  nameEditSave: { padding: 4 },
  userId:     { ...type.caption, color: colors.textTertiary, marginTop: 3 },

  // Section
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:  { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md,
  },
  addButtonLabel: { ...type.label, color: '#fff', fontWeight: '700' },
  emptyText: { ...type.body, color: colors.textTertiary, padding: spacing.xl, textAlign: 'center' },

  // Household rows
  hhRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  hhRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  hhIconRing: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  hhName:   { ...type.bodyMed, color: colors.textPrimary },
  hhActive: { ...type.caption, color: colors.accent, marginTop: 1 },
  switchButton: {
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
  },
  switchButtonLabel: { ...type.label, color: colors.textSecondary },
  editIconButton: { padding: 4 },

  // Settings rows
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg,
  },
  settingsRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  settingsLabel: { ...type.bodyMed, color: colors.textSecondary },

  // Sheet
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xxl, paddingBottom: 40, paddingTop: spacing.lg,
    gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border,
  },
  dragHandle: {
    width: 36, height: 4, backgroundColor: colors.borderStrong,
    borderRadius: 2, alignSelf: 'center', marginBottom: 4,
  },
  sheetTitle: { ...type.h3, color: colors.textPrimary },

  tabRow: {
    flexDirection: 'row', backgroundColor: colors.muted,
    borderRadius: radius.md, padding: 4, gap: 4,
  },
  tabButton: {
    flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.sm,
  },
  tabButtonActive: { backgroundColor: colors.surfaceElevated },
  tabLabel:        { ...type.label, color: colors.textTertiary },
  tabLabelActive:  { color: colors.accent },

  inputLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  primaryButton: {
    height: 52, backgroundColor: colors.accent, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryButtonLabel: { ...type.h4, color: '#fff' },
  cancelButton: {
    height: 48, backgroundColor: colors.muted, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelLabel: { ...type.bodyMed, color: colors.textSecondary },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },
});
