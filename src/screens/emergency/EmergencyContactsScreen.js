import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { subscribeEmergencyContacts } from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { Rise, useEntranceReplay } from '../../components/Motion';

export default function EmergencyContactsScreen() {
  const { householdId } = useAuth();
  const { colors } = useTheme();
  const navScrollProps = useNavScrollProps();
  const isDesktop = useIsDesktop();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [contacts, setContacts] = useState([]);
  const contentKey = useEntranceReplay();

  useEffect(() => {
    if (!householdId) return;
    const unsub = subscribeEmergencyContacts(householdId, (data) => {
      setContacts(data.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)));
    });
    return unsub;
  }, [householdId]);

  const handleCall = (phone) => {
    Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() => {});
  };

  return (
    <SafeAreaView style={[styles.root, Platform.OS === 'android' && { paddingTop: 24 }]}>
      <ScrollView
        key={contentKey}
        style={{ flex: 1 }}
        {...navScrollProps}
        contentContainerStyle={[
          styles.container,
          isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — same pattern as HomeLightsScreen */}
        <Rise index={0}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Emergency Contacts</Text>
            <Text style={styles.subtitle}>
              {contacts.length === 0
                ? 'Add contacts in household settings'
                : `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="alert-circle" size={13} color={colors.danger} />
            <Text style={styles.headerBadgeText}>Emergency</Text>
          </View>
        </View>
        </Rise>

        {contacts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No contacts yet</Text>
            <Text style={styles.emptySub}>
              Add emergency contacts in your household settings.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {contacts.map((contact, i) => (
              <Rise key={contact.id} index={Math.min(i + 1, 8)} style={styles.card}>
                <View style={styles.iconWrap}>
                  <Text style={styles.contactIcon}>{contact.icon}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name}>{contact.name}</Text>
                  {!!contact.relationship && (
                    <Text style={styles.relationship}>{contact.relationship}</Text>
                  )}
                  {!!contact.phone && (
                    <TouchableOpacity
                      onPress={() => handleCall(contact.phone)}
                      style={styles.phoneRow}
                      accessibilityRole="link"
                      accessibilityLabel={`Call ${contact.name}`}
                    >
                      <Ionicons name="call-outline" size={13} color={colors.accent} />
                      <Text style={styles.phone}>{contact.phone}</Text>
                    </TouchableOpacity>
                  )}
                  {!!contact.notes && (
                    <Text style={styles.notes}>{contact.notes}</Text>
                  )}
                </View>
                {!!contact.phone && (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => handleCall(contact.phone)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${contact.name}`}
                  >
                    <Ionicons name="call" size={18} color="#fff" />
                  </TouchableOpacity>
                )}
              </Rise>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.danger,
  },
  headerBadgeText: { ...type.caption, color: colors.danger, fontWeight: '700' },

  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: 80 },
  emptyTitle: { ...type.h4, color: colors.textSecondary },
  emptySub:   { ...type.body, color: colors.textTertiary, textAlign: 'center', maxWidth: 260 },

  list: { gap: spacing.md },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: radius.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  contactIcon: { fontSize: 24 },
  info:        { flex: 1, gap: 3 },
  name:        { ...type.bodyMed, color: colors.textPrimary },
  relationship: {
    ...type.caption, color: colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  phone:    { ...type.bodySm, color: colors.accent },
  notes:    { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  callBtn: {
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
});
