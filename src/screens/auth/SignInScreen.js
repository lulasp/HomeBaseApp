import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Platform,
} from 'react-native';
import { GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { auth } from '../../config/firebase';
import { spacing, radius, type } from '../../theme/colors';
import { Rise } from '../../components/Motion';

if (Platform.OS !== 'web') {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
}

export default function SignInScreen() {
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);

  const signIn = useCallback(async () => {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        try {
          await signInWithPopup(auth, provider);
        } catch (e) {
          // Some browsers (notably desktop Firefox) block the popup — fall back
          // to a full-page redirect, completed via getRedirectResult in AuthContext.
          if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
            await signInWithRedirect(auth, provider);
            return;
          }
          throw e;
        }
      } else {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo.data?.idToken;
        if (!idToken) throw new Error('No ID token returned from Google.');
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      }
    } catch (e) {
      if (e.code !== 'SIGN_IN_CANCELLED') {
        showAlert({ title: 'Sign-in failed', message: e.message, type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>

        <Rise index={0} style={styles.heroSection}>
          <View style={styles.logoRing}>
            <View style={styles.logoIcon}>
              <Ionicons name="home" size={30} color="#fff" />
            </View>
          </View>
          <Text style={styles.appName}>HomeBase</Text>
          <Text style={styles.tagline}>Your family's home hub</Text>
        </Rise>

        <Rise index={1} style={styles.card}>
          <Text style={styles.cardTitle}>Welcome back</Text>
          <Text style={styles.cardSubtitle}>
            Sign in to access your household. Your data is secured and only shared with your household members.
          </Text>

          <TouchableOpacity
            style={[styles.googleButton, loading && styles.buttonDisabled]}
            onPress={signIn}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Google"
          >
            {loading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={colors.textPrimary} />
                <Text style={styles.googleButtonLabel}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>
        </Rise>

      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1, paddingHorizontal: spacing.xl,
    paddingTop: 60, paddingBottom: 40, justifyContent: 'center',
  },

  heroSection:  { alignItems: 'center', marginBottom: 48 },
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
    shadowColor: colors.accent, shadowOpacity: 0.45,
    shadowRadius: 20, shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  appName:  { ...type.h1, color: colors.textPrimary, marginBottom: 8 },
  tagline:  { ...type.body, color: colors.textSecondary },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.xxl,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.12,
    shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
    elevation: 10, gap: spacing.lg,
  },
  cardTitle:    { ...type.h3, color: colors.textPrimary },
  cardSubtitle: { ...type.body, color: colors.textSecondary, lineHeight: 22 },

  googleButton: {
    height: 52, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  buttonDisabled:    { opacity: 0.5 },
  googleButtonLabel: { ...type.bodyMed, color: colors.textPrimary },
});
