import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { createHousehold, joinHousehold } from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { Rise } from '../../components/Motion';
import { t } from '../../i18n';
import { useLanguage } from '../../context/LanguageContext';

export default function HouseholdScreen() {
  const { user, saveHouseholdId, signOut } = useAuth();
  const { colors } = useTheme();
  useLanguage();
  const { showAlert } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [activeTab, setActiveTab] = useState('create');
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  const withTimeout = (promise, ms = 8000) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(
          t('auth.timedOut')
        )), ms)
      ),
    ]);

  const handleCreate = async () => {
    if (!householdName.trim()) { showAlert({ title: t('auth.missingName'), message: t('auth.missingNameMessage'), type: 'info' }); return; }
    setLoading(true);
    try {
      const profile = { name: user.displayName || '', email: user.email || '' };
      const id = await withTimeout(createHousehold(user.uid, householdName.trim(), profile));
      await saveHouseholdId(id);
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) { showAlert({ title: t('auth.missingCode'), message: t('auth.missingCodeMessage'), type: 'info' }); return; }
    setLoading(true);
    try {
      const profile = { name: user.displayName || '', email: user.email || '' };
      const id = await withTimeout(joinHousehold(user.uid, inviteCode.trim(), profile));
      await saveHouseholdId(id);
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screenRoot}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          <Rise index={0} style={styles.heroSection}>
            <View style={styles.logoRing}>
              <View style={styles.logoIcon}>
                <Ionicons name="home" size={30} color="#fff" />
              </View>
            </View>
            <Text style={styles.appName}>HomeBase</Text>
            <Text style={styles.tagline}>{t('auth.tagline')}</Text>
          </Rise>

          <Rise index={1} style={styles.authCard}>
            <View style={styles.tabRow}>
              {[
                { id: 'create', icon: 'add-circle-outline', label: t('auth.create') },
                { id: 'join',   icon: 'people-outline',     label: t('auth.join') },
              ].map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
                  onPress={() => setActiveTab(tab.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeTab === tab.id }}
                >
                  <Ionicons
                    name={tab.icon}
                    size={15}
                    color={activeTab === tab.id ? colors.accent : colors.textTertiary}
                  />
                  <Text style={[styles.tabButtonLabel, activeTab === tab.id && styles.tabButtonLabelActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {activeTab === 'create' ? (
              <View style={styles.formSection}>
                <Text style={styles.inputLabel}>{t('auth.householdName')}</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={t('profile.householdNamePlaceholder')}
                  value={householdName}
                  onChangeText={setHouseholdName}
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                  accessibilityLabel={t('auth.householdNameA11y')}
                />
                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                  onPress={handleCreate}
                  disabled={loading}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonLabel}>{loading ? t('profile.creating') : t('profile.createHousehold')}</Text>
                  {!loading && <Ionicons name="arrow-forward" size={17} color="#fff" />}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.formSection}>
                <Text style={styles.inputLabel}>{t('auth.inviteCode')}</Text>
                <TextInput
                  style={[styles.textInput, styles.inviteCodeInput]}
                  placeholder="ABC123"
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  autoCapitalize="characters"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleJoin}
                  accessibilityLabel={t('auth.inviteCodeA11y')}
                />
                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                  onPress={handleJoin}
                  disabled={loading}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonLabel}>{loading ? t('profile.joining') : t('profile.joinHousehold')}</Text>
                  {!loading && <Ionicons name="arrow-forward" size={17} color="#fff" />}
                </TouchableOpacity>
              </View>
            )}
          </Rise>

          <Rise index={2}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={signOut}
            accessibilityRole="button"
            accessibilityLabel={t('auth.logOut')}
          >
            <Ionicons name="log-out-outline" size={17} color={colors.textSecondary} />
            <Text style={styles.logoutLabel}>{t('auth.logOut')}</Text>
          </TouchableOpacity>
          </Rise>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1, paddingHorizontal: spacing.xl,
    paddingTop: 60, paddingBottom: 40, justifyContent: 'center',
  },

  heroSection: { alignItems: 'center', marginBottom: 48 },
  logoRing: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  logoIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  appName:  { ...type.h1, color: colors.textPrimary, marginBottom: 8 },
  tagline:  { ...type.body, color: colors.textSecondary },

  authCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.xxl,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: 4, gap: 4,
    marginBottom: spacing.xxl,
  },
  tabButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.sm,
  },
  tabButtonActive:      { backgroundColor: colors.surfaceElevated },
  tabButtonLabel:       { ...type.bodyMed, color: colors.textTertiary },
  tabButtonLabelActive: { color: colors.accent },

  formSection: { gap: spacing.md },
  inputLabel:  { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 52,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  inviteCodeInput: { textAlign: 'center', letterSpacing: 6, ...type.h4 },

  primaryButton: {
    height: 52, backgroundColor: colors.accent,
    borderRadius: radius.md, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonLabel:    { ...type.h4, color: '#fff' },

  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.xxl, paddingVertical: spacing.md,
  },
  logoutLabel: { ...type.bodyMed, color: colors.textSecondary },
});
