import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged, getRedirectResult, updateProfile, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../config/firebase';
import { getHouseholdsForUser, upsertMemberProfile, migrateHouseholdSecrets } from '../services/firestore';

const HOUSEHOLD_KEY     = '@homebase_household_id';
const HOUSEHOLD_IDS_KEY = '@homebase_household_ids';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]                 = useState(null);
  const [displayName, setDisplayName]   = useState('');
  const [householdId, setHouseholdId]   = useState(null);
  const [householdIds, setHouseholdIds] = useState([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    // Complete a redirect-based Google sign-in (popup fallback on web).
    if (Platform.OS === 'web') {
      getRedirectResult(auth).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setDisplayName(firebaseUser.displayName || '');

        const storedActive = await AsyncStorage.getItem(HOUSEHOLD_KEY);

        // Firestore membership is the source of truth — recovers households on a
        // fresh device where AsyncStorage is empty. Fall back to the local cache
        // only if the query fails (e.g. offline), so we don't wipe state.
        let ids;
        try {
          const households = await getHouseholdsForUser(firebaseUser.uid);
          ids = households.map((h) => h.id);

          // Move any legacy secrets/profiles off the world-readable parent doc,
          // then keep this member's name/email current in the private doc so
          // member lists show real identities instead of UIDs across devices.
          const p = { name: (firebaseUser.displayName || '').trim(), email: (firebaseUser.email || '').trim() };
          households.forEach((h) => {
            migrateHouseholdSecrets(h.id)
              .catch(() => {})
              .finally(() => upsertMemberProfile(h.id, firebaseUser.uid, p).catch(() => {}));
          });
        } catch (e) {
          const hidsRaw = await AsyncStorage.getItem(HOUSEHOLD_IDS_KEY);
          ids = hidsRaw ? JSON.parse(hidsRaw) : (storedActive ? [storedActive] : []);
        }

        // Keep the last-active household if still valid, else pick the first.
        const active = (storedActive && ids.includes(storedActive)) ? storedActive : (ids[0] || null);

        await AsyncStorage.setItem(HOUSEHOLD_IDS_KEY, JSON.stringify(ids));
        if (active) await AsyncStorage.setItem(HOUSEHOLD_KEY, active);
        else        await AsyncStorage.removeItem(HOUSEHOLD_KEY);

        setHouseholdIds(ids);
        setHouseholdId(active);
      } else {
        setUser(null);
        setDisplayName('');
        setHouseholdId(null);
        setHouseholdIds([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const saveHouseholdId = async (id) => {
    const next = householdIds.includes(id) ? householdIds : [...householdIds, id];
    await AsyncStorage.setItem(HOUSEHOLD_IDS_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
    setHouseholdIds(next);
    setHouseholdId(id);
  };

  const switchHousehold = async (id) => {
    await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
    setHouseholdId(id);
  };

  const removeHousehold = async (id) => {
    const remaining = householdIds.filter((h) => h !== id);
    const newActive = householdId === id ? (remaining[0] ?? null) : householdId;
    await AsyncStorage.setItem(HOUSEHOLD_IDS_KEY, JSON.stringify(remaining));
    await AsyncStorage.setItem(HOUSEHOLD_KEY, newActive ?? '');
    setHouseholdIds(remaining);
    setHouseholdId(newActive);
  };

  const updateDisplayName = async (name) => {
    const trimmed = name.trim();
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: trimmed });
      // Sync the new name to every household's member profile so member lists
      // reflect the edit immediately, not only after the next login.
      const p = { name: trimmed, email: (auth.currentUser.email || '').trim() };
      householdIds.forEach((id) => upsertMemberProfile(id, auth.currentUser.uid, p).catch(() => {}));
    }
    setDisplayName(trimmed);
  };

  const signOut = async () => {
    await AsyncStorage.multiRemove([HOUSEHOLD_KEY, HOUSEHOLD_IDS_KEY]);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{
      user, displayName, householdId, householdIds, loading,
      saveHouseholdId, switchHousehold, removeHousehold, updateDisplayName, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
